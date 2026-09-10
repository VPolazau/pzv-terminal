import { connectRedis, closeRedis } from '@pzv-terminal/core-redis';
import { MONITORING_STRATEGY as strategy } from '@pzv-terminal/core-config';
import {
  BinanceHttpError,
  fetchBinancePrice,
  fetchBinanceTime,
  timeframeMs,
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
const day = 86400000;
const now = 400 * day + 30000;
const streams = strategy.symbols.flatMap((symbol) =>
  strategy.timeframes.map((tf) => `${symbol}:${tf}`),
);
const priceBySymbol: Record<string, number> = {
  BTCUSDT: 110,
  ETHUSDT: 210,
  XRPUSDT: 310,
  TAOUSDT: 410,
};
const historyFor: typeof syncBinanceCandles = async ({
  symbol,
  tf,
  serverTime,
  limit,
}) => {
  const currentIndex = Math.floor(serverTime / timeframeMs(tf));
  return Array.from({ length: limit }, (_, i) =>
    candle(currentIndex - limit + i, tf, priceBySymbol[symbol] - 10, symbol),
  );
};

describe('multi-symbol Runner', () => {
  let runner: RunnerService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    jest.replaceProperty(process, 'env', {
      DATA_SOURCE: 'binance',
      RUNNER_MODE: 'single',
      MOCK_TIME_SCALE: '60',
    });
    jest.mocked(connectRedis).mockResolvedValue(memoryRedis().redis);
    jest.mocked(closeRedis).mockResolvedValue(undefined);
    time.mockResolvedValue(now);
    price.mockImplementation(async (symbol) => ({
      price: priceBySymbol[symbol],
      observedAt: Date.now(),
    }));
    sync.mockImplementation(historyFor);
    processLive.mockResolvedValue(null);
    runner = new RunnerService();
  });
  afterEach(async () => {
    await runner.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('initializes exactly eight isolated streams and shares each symbol price across its timeframes', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(8);
    expect(price).toHaveBeenCalledTimes(4);
    expect(
      processLive.mock.calls.map(([p]) => `${p.symbol}:${p.tf}`).sort(),
    ).toEqual([...streams].sort());
    for (const [p] of processLive.mock.calls) {
      expect(p.price).toBe(priceBySymbol[p.symbol]);
      expect(p.candles).toHaveLength(300);
      expect(
        p.candles.every(
          (c) =>
            c.symbol === p.symbol &&
            c.tf === p.tf &&
            c.closeTime < p.candleOpenTime,
        ),
      ).toBe(true);
    }
    await jest.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(8);
    expect(price).toHaveBeenCalledTimes(8);
    for (const [p] of processLive.mock.calls)
      expect(p.candles[0].close).toBe(priceBySymbol[p.symbol] - 10);
  });
  it('resyncs only the four 4h windows on a 4h boundary', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    time.mockResolvedValue(400 * day + timeframeMs('4h') + 1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(12);
    expect(sync.mock.calls.slice(8).every(([p]) => p.tf === '4h')).toBe(true);
  });
  it('resyncs all eight streams on a day boundary', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    time.mockResolvedValue(401 * day + 1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sync).toHaveBeenCalledTimes(16);
  });
  it('isolates one failed history, backs off, and keeps all other cached windows', async () => {
    sync.mockImplementation(async (p) => {
      if (p.symbol === 'TAOUSDT' && p.tf === '1d') throw new Error('temporary');
      return historyFor(p);
    });
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(2100);
    expect(
      sync.mock.calls.filter(([p]) => p.symbol === 'TAOUSDT' && p.tf === '1d'),
    ).toHaveLength(2);
    expect(
      sync.mock.calls.filter(
        ([p]) => !(p.symbol === 'TAOUSDT' && p.tf === '1d'),
      ),
    ).toHaveLength(7);
    expect(processLive).toHaveBeenCalledTimes(21);
    sync.mockImplementation(historyFor);
    await jest.advanceTimersByTimeAsync(1000);
    expect(
      processLive.mock.calls.some(
        ([p]) => p.symbol === 'TAOUSDT' && p.tf === '1d',
      ),
    ).toBe(true);
  });
  it('does not reuse stale history after a failed rollover but continues healthy streams', async () => {
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    processLive.mockClear();
    time.mockResolvedValue(400 * day + timeframeMs('4h') + 1);
    sync.mockImplementation(async (p) => {
      if (p.symbol === 'BTCUSDT' && p.tf === '4h') throw new Error('temporary');
      return historyFor(p);
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(processLive).toHaveBeenCalledTimes(7);
    expect(
      processLive.mock.calls.some(
        ([p]) => p.symbol === 'BTCUSDT' && p.tf === '4h',
      ),
    ).toBe(false);
  });
  it('isolates a symbol price failure from all other symbols', async () => {
    price.mockImplementation(async (symbol) => {
      if (symbol === 'BTCUSDT') throw new Error('temporary');
      return { price: priceBySymbol[symbol], observedAt: Date.now() };
    });
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(processLive).toHaveBeenCalledTimes(6);
    expect(processLive.mock.calls.every(([p]) => p.symbol !== 'BTCUSDT')).toBe(
      true,
    );
  });
  it('honors IP-wide Binance Retry-After without request bursts', async () => {
    time.mockRejectedValueOnce(new BinanceHttpError(429, 5000));
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(4100);
    expect(time).toHaveBeenCalledTimes(1);
    expect(price).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(time).toHaveBeenCalledTimes(2);
    expect(price).toHaveBeenCalledTimes(4);
  });
  it('skips 4h calculations if price responses cross a 4h boundary', async () => {
    time.mockResolvedValue(400 * day + timeframeMs('4h') - 1);
    price.mockImplementation(
      (symbol) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ price: priceBySymbol[symbol], observedAt: Date.now() }),
            10,
          ),
        ),
    );
    await runner.onModuleInit();
    await jest.advanceTimersByTimeAsync(100);
    expect(processLive).toHaveBeenCalledTimes(4);
    expect(processLive.mock.calls.every(([p]) => p.tf === '1d')).toBe(true);
  });
  it('keeps observing during slow delivery and shuts down without overlap', async () => {
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
    expect(price).toHaveBeenCalledTimes(12);
    expect(flush).toHaveBeenCalledTimes(1);
    const stopping = runner.onModuleDestroy();
    release();
    await stopping;
    await jest.advanceTimersByTimeAsync(3000);
    expect(price).toHaveBeenCalledTimes(12);
    expect(closeRedis).toHaveBeenCalled();
  });
});
