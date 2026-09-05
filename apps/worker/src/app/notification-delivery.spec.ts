import type { LiveSignalEvent } from '@pzv-terminal/shared-types';
import {
  sendTelegramMessage,
  TelegramDeliveryError,
} from '@pzv-terminal/shared-utils';
import { memoryRedis } from '../../test-support/redis';
import {
  NotificationDelivery,
  pendingNotification,
  pendingNotificationsKey,
  notificationRecipients,
} from './notification-delivery';

jest.mock('@pzv-terminal/shared-utils', () => ({
  ...jest.requireActual('@pzv-terminal/shared-utils'),
  sendTelegramMessage: jest.fn(),
}));
const send = jest.mocked(sendTelegramMessage);
const event: LiveSignalEvent = {
  id: 'event-1',
  type: 'sma_cross',
  mode: 'live',
  source: 'binance',
  symbol: 'BTCUSDT',
  tf: '1m',
  fast: 10,
  slow: 50,
  signal: 'bull_cross',
  price: 110,
  ts: 1000,
  observedAt: 1000,
  detectedAt: 1001,
  candleOpenTime: 0,
  candleCloseTime: 59999,
  now: { fast: 101, slow: 100.2 },
  prev: { fast: 99, slow: 99.8 },
};

describe('Telegram pending delivery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10000);
    jest.replaceProperty(process, 'env', { TELEGRAM_BOT_TOKEN: 'test-token' });
    send.mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('selects the configured single recipient without requiring subscriptions', async () => {
    jest.replaceProperty(process, 'env', {
      RUNNER_MODE: 'single',
      TELEGRAM_CHAT_ID: 'test-recipient',
    });
    const memory = memoryRedis();
    expect(await notificationRecipients(memory.redis, 'BTCUSDT', '4h')).toEqual(
      ['test-recipient'],
    );
    expect(memory.sMembers).not.toHaveBeenCalled();
  });

  it('stops between deliveries and retains unsent events for restart', async () => {
    const memory = memoryRedis();
    const second = { ...event, id: 'second', ts: 2000 };
    for (const item of [event, second]) {
      await memory.hSet(
        pendingNotificationsKey,
        item.id,
        JSON.stringify(pendingNotification(item.id, item, ['one'])),
      );
    }
    let release!: () => void;
    send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const delivery = new NotificationDelivery(memory.redis, jest.fn());
    const flushing = delivery.flush();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    delivery.stop();
    release();
    await flushing;
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(memory.hashes.get(pendingNotificationsKey) ?? {}),
    ).toEqual(['second']);
  });
  it('retains failed delivery, retries after backoff, and never repeats confirmed success', async () => {
    const memory = memoryRedis();
    await memory.hSet(
      pendingNotificationsKey,
      event.id,
      JSON.stringify(pendingNotification(event.id, event, ['one'])),
    );
    send
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const delivery = new NotificationDelivery(memory.redis, jest.fn());
    await delivery.flush();
    const failed = JSON.parse(
      (memory.hashes.get(pendingNotificationsKey) ?? {})[event.id],
    );
    expect(failed.recipients[0].deliveredAt).toBeUndefined();
    expect(failed.recipients[0].attempts).toBe(1);
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(1);
    jest.setSystemTime(11001);
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(memory.hashes.get(pendingNotificationsKey)).toEqual({});
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('resumes pending delivery after restart and does not resend to successful subscribers', async () => {
    const memory = memoryRedis();
    await memory.hSet(
      pendingNotificationsKey,
      event.id,
      JSON.stringify(pendingNotification(event.id, event, ['one', 'two'])),
    );
    send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    await new NotificationDelivery(memory.redis, jest.fn()).flush();
    jest.setSystemTime(11001);
    await new NotificationDelivery(memory.redis, jest.fn()).flush();
    expect(send.mock.calls.map(([args]) => args.chatId)).toEqual([
      'one',
      'two',
      'two',
    ]);
  });
  it('does not resend in-process if Redis persistence fails after Telegram success', async () => {
    const memory = memoryRedis();
    await memory.hSet(
      pendingNotificationsKey,
      event.id,
      JSON.stringify(pendingNotification(event.id, event, ['one'])),
    );
    send.mockResolvedValue(undefined);
    memory.hSet.mockRejectedValueOnce(new Error('Redis acknowledgement lost'));
    const delivery = new NotificationDelivery(memory.redis, jest.fn());
    await delivery.flush();
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(memory.hashes.get(pendingNotificationsKey)).toEqual({});
  });
  it('delivers the other timeframe while one Telegram request is slow', async () => {
    const memory = memoryRedis();
    const other = { ...event, id: 'event-4h', tf: '4h' as const };
    for (const e of [event, other])
      await memory.hSet(
        pendingNotificationsKey,
        e.id,
        JSON.stringify(pendingNotification(e.id, e, ['one'])),
      );
    let release!: () => void;
    send.mockImplementation(({ text }) =>
      text.includes('TF: 1m')
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(),
    );
    const flushing = new NotificationDelivery(memory.redis, jest.fn()).flush();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (memory.hashes.get(pendingNotificationsKey) ?? {})['event-4h'],
    ).toBeUndefined();
    release();
    await flushing;
  });
  it('preserves bull/bear/bull delivery order and honors Telegram retry_after', async () => {
    const memory = memoryRedis();
    const events = [
      event,
      { ...event, id: 'event-2', signal: 'bear_cross' as const, ts: 2000 },
      { ...event, id: 'event-3', ts: 3000 },
    ];
    for (const e of events)
      await memory.hSet(
        pendingNotificationsKey,
        e.id,
        JSON.stringify(pendingNotification(e.id, e, ['one'])),
      );
    send
      .mockRejectedValueOnce(new TelegramDeliveryError('rate limited', 3))
      .mockResolvedValue(undefined);
    const delivery = new NotificationDelivery(memory.redis, jest.fn());
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(1);
    jest.setSystemTime(12000);
    await delivery.flush();
    expect(send).toHaveBeenCalledTimes(1);
    jest.setSystemTime(13001);
    await delivery.flush();
    expect(
      send.mock.calls.map(([args]) => args.text.match(/Signal: (\w+)/)?.[1]),
    ).toEqual(['bull_cross', 'bull_cross', 'bear_cross', 'bull_cross']);
  });
});
