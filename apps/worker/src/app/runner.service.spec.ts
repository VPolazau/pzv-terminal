import { connectRedis, closeRedis } from '@pzv-terminal/core-redis';
import {
  fetchBinancePrice,
  fetchBinanceTime,
} from '@pzv-terminal/shared-utils';
import { syncBinanceCandles } from '../jobs/binance-candles.job';
import { processLiveObservation } from './live-signal.processor';
import { NotificationDelivery } from './notification-delivery';
import { RunnerService } from './runner.service';
import { candle, memoryRedis } from '../../test-support/redis';

jest.mock('@pzv-terminal/core-logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn() }),
}));
jest.mock('@pzv-terminal/core-redis', () => ({
  connectRedis: jest.fn(),
  closeRedis: jest.fn(),
}));
jest.mock('@pzv-terminal/shared-utils', () => ({
  ...jest.requireActual('@pzv-terminal/shared-utils'),
  fetchBinanceTime: jest.fn(),
  fetchBinancePrice: jest.fn(),
}));
jest.mock('../jobs/binance-candles.job', () => ({
  syncBinanceCandles: jest.fn(),
}));
jest.mock('./live-signal.processor', () => ({
  processLiveObservation: jest.fn(),
}));
jest.mock('./notification-delivery', () => ({
  NotificationDelivery: jest.fn().mockImplementation(() => ({
    flush: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
  })),
}));
const sync = jest.mocked(syncBinanceCandles);
const price = jest.mocked(fetchBinancePrice);
const time = jest.mocked(fetchBinanceTime);
const processLive = jest.mocked(processLiveObservation);

describe('Runner lifecycle and timeframe isolation', () => {
  let runner: RunnerService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(50000000);
    jest.clearAllMocks();
    jest.replaceProperty(process, 'env', {
      DATA_SOURCE: 'binance',
      RUNNER_MODE: 'single',
      MOCK_TIME_SCALE: '60',
    });
    jest.mocked(connectRedis).mockResolvedValue(memoryRedis().redis);
    jest.mocked(closeRedis).mockResolvedValue(undefined);
    time.mockResolvedValue(43230000);
    price.mockResolvedValue({ price: 110, observedAt: 50000000 });
    sync.mockImplementation(async ({ tf }) =>
      Array.from({ length: 200 }, (_, i) => candle(i, tf)),
    );
    processLive.mockResolvedValue(null);
    runner = new RunnerService();
  });
  afterEach(async () => {
    await runner.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('uses one price for both timeframes and resyncs only when a real candle rolls over', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(price).toHaveBeenCalledTimes(1);
    expect(processLive.mock.calls.map(([p]) => p.tf).sort()).toEqual([
      '1m',
      '4h',
    ]);
    for (const [p] of processLive.mock.calls) expect(p.price).toBe(110);
    expect(sync).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(2);
    time.mockResolvedValue(43260001);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(3);
    expect(sync.mock.calls[2][0].tf).toBe('1m');
  });
  it('still processes 4h when synchronization of 1m fails', async () => {
    sync.mockImplementation(async ({ tf }) => {
      if (tf === '1m') throw new Error('temporary');
      return Array.from({ length: 200 }, (_, i) => candle(i, tf));
    });
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(processLive).toHaveBeenCalledTimes(1);
    expect(processLive.mock.calls[0][0].tf).toBe('4h');
    expect(price).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a previous timeframe history if rollover synchronization fails', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    processLive.mockClear();
    time.mockResolvedValue(43260001);
    sync.mockRejectedValue(new Error('temporary'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(processLive).toHaveBeenCalledTimes(1);
    expect(processLive.mock.calls[0][0].tf).toBe('4h');
  });
  it('skips a timeframe if the price request crosses its candle boundary', async () => {
    time.mockResolvedValue(43259999);
    price.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ price: 110, observedAt: Date.now() }), 10),
        ),
    );
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(processLive).toHaveBeenCalledTimes(1);
    expect(processLive.mock.calls[0][0].tf).toBe('4h');
  });
  it('keeps calculating while Telegram delivery is slow and stops both loops on shutdown', async () => {
    let release!: () => void;
    const flush = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    jest
      .mocked(NotificationDelivery)
      .mockImplementationOnce(
        () => ({ flush, stop: jest.fn() }) as unknown as NotificationDelivery,
      );
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(2100);
    expect(price).toHaveBeenCalledTimes(3);
    expect(flush).toHaveBeenCalledTimes(1);
    const stopping = runner.onModuleDestroy();
    release();
    await stopping;
    const count = price.mock.calls.length;
    await jest.advanceTimersByTimeAsync(3000);
    expect(price).toHaveBeenCalledTimes(count);
    expect(closeRedis).toHaveBeenCalled();
  });
});
