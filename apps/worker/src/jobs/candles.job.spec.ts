import { appendMockCandle, candlesKey } from './candles.job';
import { candle, memoryRedis } from '../../test-support/redis';

describe('mock candle isolation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_500);
    jest.replaceProperty(process, 'env', { MOCK_TIME_SCALE: '60' });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('replaces Binance data with closed mock history without a bootstrap event', async () => {
    const memory = memoryRedis();
    memory.strings.set(
      candlesKey('BTCUSDT', '1m'),
      JSON.stringify([candle(0)]),
    );
    const params = {
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '1m' as const,
      limit: 200,
    };
    const result = await appendMockCandle(params);
    expect(result.appended).toBeUndefined();
    expect(
      result.candles.every(
        (c) => c.source === 'mock' && c.closeTime <= Date.now(),
      ),
    ).toBe(true);
    expect((await appendMockCandle(params)).appended).toBeUndefined();
    jest.setSystemTime(1_001_100);
    expect((await appendMockCandle(params)).appended?.closeTime).toBe(
      1_001_000,
    );
  });
});
