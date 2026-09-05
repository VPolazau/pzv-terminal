import { liveStateKey, processLiveObservation } from './live-signal.processor';
import { pendingNotificationsKey } from './notification-delivery';
import { candle, memoryRedis } from '../../test-support/redis';

describe('persisted live transitions', () => {
  beforeEach(() =>
    jest.replaceProperty(process, 'env', { RUNNER_MODE: 'subs' }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('initializes silently and atomically persists three distinct events in one candle', async () => {
    const memory = memoryRedis();
    memory.sMembers.mockResolvedValue(['subscriber']);
    const params = {
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '1m' as const,
      candles: Array.from({ length: 49 }, (_, i) => candle(i)),
      observedAt: 3000000,
      candleOpenTime: 3000000,
    };
    expect(await processLiveObservation({ ...params, price: 90 })).toBeNull();
    expect(memory.hashes.size).toBe(0);
    const events = [];
    for (const price of [110, 90, 110])
      events.push(await processLiveObservation({ ...params, price }));
    expect(events.map((e) => e?.signal)).toEqual([
      'bull_cross',
      'bear_cross',
      'bull_cross',
    ]);
    expect(new Set(events.map((e) => e?.id)).size).toBe(3);
    expect(
      Object.keys(memory.hashes.get(pendingNotificationsKey) ?? {}),
    ).toHaveLength(3);
    expect(events[0]).toMatchObject({
      mode: 'live',
      source: 'binance',
      price: 110,
      candleOpenTime: 3000000,
      candleCloseTime: 3059999,
      observedAt: 3000000,
    });
    // A fresh invocation reloads state from Redis; no process-local baseline.
    expect(await processLiveObservation({ ...params, price: 110 })).toBeNull();
    expect(
      JSON.parse(memory.strings.get(liveStateKey('BTCUSDT', '1m')) ?? '{}')
        .direction,
    ).toBe('above');
  });
  it('does not advance state if transaction cannot be committed', async () => {
    const memory = memoryRedis();
    memory.sMembers.mockResolvedValue(['subscriber']);
    const params = {
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '1m' as const,
      candles: Array.from({ length: 49 }, (_, i) => candle(i)),
      observedAt: 3000000,
      candleOpenTime: 3000000,
    };
    await processLiveObservation({ ...params, price: 90 });
    const before = memory.strings.get(liveStateKey('BTCUSDT', '1m'));
    const transaction = memory.multi();
    transaction.exec.mockRejectedValueOnce(new Error('Redis unavailable'));
    memory.multi.mockReturnValueOnce(transaction);
    await expect(
      processLiveObservation({ ...params, price: 110 }),
    ).rejects.toThrow('Redis unavailable');
    expect(memory.strings.get(liveStateKey('BTCUSDT', '1m'))).toBe(before);
    expect(memory.hashes.size).toBe(0);
  });
});
