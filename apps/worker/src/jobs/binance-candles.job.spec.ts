import { fetchBinanceKlines } from '@pzv-terminal/shared-utils';
import { candlesKey } from './candles.job';
import {
  normalizeClosedCandles,
  syncBinanceCandles,
} from './binance-candles.job';
import { candle, memoryRedis } from '../../test-support/redis';

jest.mock('@pzv-terminal/shared-utils', () => ({
  ...jest.requireActual('@pzv-terminal/shared-utils'),
  fetchBinanceKlines: jest.fn(),
}));
const fetchKlines = jest.mocked(fetchBinanceKlines);

describe('Binance closed history', () => {
  beforeEach(() => jest.clearAllMocks());
  it('normalizes overlapping batches by openTime, preferring updated values, and excludes forming candles', () => {
    const result = normalizeClosedCandles(
      [candle(2), candle(0), candle(1), candle(1, '1m', 110), candle(3)],
      180001,
      3,
    );
    expect(result.map((c) => c.openTime)).toEqual([0, 60000, 120000]);
    expect(result[1].close).toBe(110);
  });
  it('bootstrap stores CLOSED candles only, even when the response includes a forming candle', async () => {
    const memory = memoryRedis();
    fetchKlines.mockResolvedValue([candle(0), candle(1), candle(2), candle(3)]);
    const result = await syncBinanceCandles({
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '1m',
      limit: 3,
      ttlSeconds: 100,
      serverTime: 180001,
    });
    expect(result).toHaveLength(3);
    expect(result.every((c) => c.closeTime < 180001)).toBe(true);
    expect(fetchKlines).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: 0, endTime: 179999, limit: 3 }),
    );
    expect(
      JSON.parse(memory.strings.get(candlesKey('BTCUSDT', '1m')) ?? 'null'),
    ).toEqual(result);
  });
  it('retains the last response candle when it really is closed', async () => {
    const memory = memoryRedis();
    fetchKlines.mockResolvedValue([candle(0), candle(1), candle(2)]);
    expect(
      await syncBinanceCandles({
        redis: memory.redis,
        symbol: 'BTCUSDT',
        tf: '1m',
        limit: 3,
        ttlSeconds: 100,
        serverTime: 180001,
      }),
    ).toHaveLength(3);
  });
  it.each([5, 5000])(
    'backfills downtime of %i intervals within the retained limit',
    async (gap) => {
      const memory = memoryRedis();
      memory.strings.set(
        candlesKey('BTCUSDT', '1m'),
        JSON.stringify([candle(0), candle(1)]),
      );
      const currentIndex = 2 + gap;
      const expected = Array.from({ length: 7 }, (_, i) =>
        candle(currentIndex - 7 + i),
      );
      fetchKlines.mockResolvedValue(expected);
      const result = await syncBinanceCandles({
        redis: memory.redis,
        symbol: 'BTCUSDT',
        tf: '1m',
        limit: 7,
        ttlSeconds: 100,
        serverTime: currentIndex * 60000 + 10,
      });
      expect(result).toEqual(expected);
      expect(result[result.length - 1]?.closeTime).toBe(
        currentIndex * 60000 - 1,
      );
    },
  );
  it('replaces mock history instead of mixing sources', async () => {
    const memory = memoryRedis();
    memory.strings.set(
      candlesKey('BTCUSDT', '1m'),
      JSON.stringify([{ ...candle(0), source: 'mock' }]),
    );
    fetchKlines.mockResolvedValue([candle(1), candle(2)]);
    const result = await syncBinanceCandles({
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '1m',
      limit: 2,
      ttlSeconds: 100,
      serverTime: 180001,
    });
    expect(result.map((c) => c.source)).toEqual(['binance', 'binance']);
    expect(result[0].openTime).toBe(60000);
  });
  it('rejects an incomplete window without replacing saved data', async () => {
    const memory = memoryRedis();
    fetchKlines.mockResolvedValue([candle(0), candle(2)]);
    await expect(
      syncBinanceCandles({
        redis: memory.redis,
        symbol: 'BTCUSDT',
        tf: '1m',
        limit: 3,
        ttlSeconds: 100,
        serverTime: 180001,
      }),
    ).rejects.toThrow('Incomplete');
    expect(memory.set).not.toHaveBeenCalled();
  });
  it('uses actual 4h timestamps regardless of mock scale', async () => {
    const memory = memoryRedis();
    fetchKlines.mockResolvedValue([candle(0, '4h'), candle(1, '4h')]);
    await syncBinanceCandles({
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '4h',
      limit: 2,
      ttlSeconds: 100,
      serverTime: 28800001,
    });
    expect(fetchKlines).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: 0, endTime: 28799999 }),
    );
  });
});
