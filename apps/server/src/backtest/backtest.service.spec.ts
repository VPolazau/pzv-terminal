import { BadRequestException } from '@nestjs/common';
import type { Candle } from '@pzv-terminal/shared-types';
import {
  BacktestService,
  validateBacktestDataQuality,
} from './backtest.service';

const step = 60_000;

function candle(openTime: number): Candle {
  return {
    symbol: 'BTCUSDT',
    tf: '1m',
    openTime,
    closeTime: openTime + step - 1,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    source: 'mock',
  };
}

function serviceWith(candles: Candle[]) {
  return new BacktestService({
    getHistoricalCandles: jest.fn().mockResolvedValue(candles),
  } as never);
}

const request = {
  symbol: 'BTCUSDT',
  timeframe: '1m',
  from: '1970-01-01T00:00:00.000Z',
  to: '1970-01-01T00:03:00.000Z',
  strategy: { type: 'SMA_CROSS', shortPeriod: 1, longPeriod: 1 },
  initialBalance: 1000,
  feeRate: 0,
  slippageRate: 0,
};

describe('backtest historical data quality', () => {
  it('accepts a complete range and returns complete metadata', async () => {
    const result = await serviceWith([
      candle(0),
      candle(step),
      candle(step * 2),
    ]).run(request);

    expect(result.dataQuality).toEqual({
      complete: true,
      expectedCandles: 3,
      actualCandles: 3,
      missingCandles: 0,
    });
  });

  it.each([[[candle(0), candle(step * 2)]], [[candle(0)]]] as [Candle[]][])(
    'rejects incomplete history with compact diagnostics',
    async (candles) => {
      await expect(serviceWith(candles).run(request)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INCOMPLETE_HISTORICAL_DATA',
          message: 'Historical data is incomplete for requested backtest range',
          dataQuality: expect.objectContaining({
            complete: false,
            expectedCandles: 3,
            actualCandles: candles.length,
            missingCandles: 3 - candles.length,
          }),
        }),
      });
    },
  );

  it('reports expected and actual counts for multiple gaps', () => {
    expect(
      validateBacktestDataQuality(
        [candle(0), candle(step * 3)],
        'BTCUSDT',
        '1m',
        0,
        step * 5,
      ),
    ).toEqual({
      complete: false,
      expectedCandles: 5,
      actualCandles: 2,
      missingCandles: 3,
      missingTimestamps: [step, step * 2, step * 4],
    });
  });

  it('keeps from inclusive and to exclusive', () => {
    expect(
      validateBacktestDataQuality(
        [candle(0), candle(step), candle(step * 2)],
        'BTCUSDT',
        '1m',
        step,
        step * 3,
      ),
    ).toEqual({
      complete: true,
      expectedCandles: 2,
      actualCandles: 2,
      missingCandles: 0,
    });
  });

  it('does not return more than five missing timestamps', () => {
    const quality = validateBacktestDataQuality(
      [],
      'BTCUSDT',
      '1m',
      0,
      step * 20,
    );
    expect(quality.expectedCandles).toBe(20);
    expect(quality.missingCandles).toBe(20);
    expect(quality.missingTimestamps).toHaveLength(5);
  });

  it('uses a validation error type for incomplete data', async () => {
    try {
      await serviceWith([candle(0)]).run(request);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
    }
  });
});
