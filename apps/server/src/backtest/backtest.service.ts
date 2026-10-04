import { BadRequestException, Injectable } from '@nestjs/common';
import {
  runBacktest,
  SmaCrossBacktestStrategy,
  type BacktestResult,
} from '@pzv-terminal/shared-utils';
import { timeframeMs } from '@pzv-terminal/shared-utils';
import { HistoricalCandleService } from '../market/historical-candle.service';
import { parseHistoryRange } from '../market/parse-history-range';
import type { Candle } from '@pzv-terminal/shared-types';

type BacktestRequest = {
  symbol?: unknown;
  timeframe?: unknown;
  tf?: unknown;
  from?: unknown;
  to?: unknown;
  strategy?: {
    type?: unknown;
    shortPeriod?: unknown;
    longPeriod?: unknown;
  };
  initialBalance?: unknown;
  feeRate?: unknown;
  slippageRate?: unknown;
};

export type BacktestDataQuality = {
  complete: boolean;
  expectedCandles: number;
  actualCandles: number;
  missingCandles: number;
  missingTimestamps?: number[];
};

export type BacktestResponse = BacktestResult & {
  dataQuality: BacktestDataQuality;
};

@Injectable()
export class BacktestService {
  constructor(private readonly historicalCandles: HistoricalCandleService) {}

  async run(request: BacktestRequest): Promise<BacktestResponse> {
    const range = parseHistoryRange({
      symbol: this.asString(request.symbol),
      tf: this.asString(request.timeframe ?? request.tf),
      from: this.asString(request.from),
      to: this.asString(request.to),
    });
    const strategyRequest = request.strategy ?? {};
    const strategyType = this.asString(strategyRequest.type) ?? 'SMA_CROSS';
    if (strategyType !== 'SMA_CROSS')
      throw new BadRequestException('Unsupported strategy');
    const shortPeriod = this.asInteger(
      strategyRequest.shortPeriod,
      1,
      'shortPeriod',
    );
    const longPeriod = this.asInteger(
      strategyRequest.longPeriod,
      238,
      'longPeriod',
    );
    if (shortPeriod > longPeriod)
      throw new BadRequestException('shortPeriod must not exceed longPeriod');

    const initialBalance = this.asNumber(
      request.initialBalance,
      10_000,
      'initialBalance',
    );
    const feeRate = this.asNumber(request.feeRate, 0.001, 'feeRate');
    const slippageRate = this.asNumber(request.slippageRate, 0, 'slippageRate');
    if (initialBalance <= 0 || feeRate < 0 || slippageRate < 0)
      throw new BadRequestException('Invalid backtest numeric parameters');

    const warmupFrom = Math.max(
      0,
      range.from - (longPeriod + 1) * timeframeMs(range.tf),
    );
    const candles = await this.historicalCandles.getHistoricalCandles(
      range.symbol,
      range.tf,
      warmupFrom,
      range.to,
    );
    const dataQuality = validateBacktestDataQuality(
      candles,
      range.symbol,
      range.tf,
      range.from,
      range.to,
    );
    if (!dataQuality.complete) {
      throw new BadRequestException({
        code: 'INCOMPLETE_HISTORICAL_DATA',
        message: 'Historical data is incomplete for requested backtest range',
        dataQuality,
      });
    }
    return {
      ...runBacktest(
        {
          symbol: range.symbol,
          timeframe: range.tf,
          from: range.from,
          to: range.to,
          initialBalance,
          feeRate,
          slippageRate,
        },
        candles,
        new SmaCrossBacktestStrategy(shortPeriod, longPeriod),
      ),
      dataQuality,
    };
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private asNumber(value: unknown, fallback: number, name: string): number {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(result))
      throw new BadRequestException(`${name} must be a number`);
    return result;
  }

  private asInteger(value: unknown, fallback: number, name: string): number {
    const result = this.asNumber(value, fallback, name);
    if (!Number.isInteger(result) || result < 1)
      throw new BadRequestException(`${name} must be a positive integer`);
    return result;
  }
}

export function validateBacktestDataQuality(
  candles: readonly Candle[],
  symbol: string,
  timeframe: BacktestResponse['config']['timeframe'],
  from: number,
  to: number,
): BacktestDataQuality {
  const step = timeframeMs(timeframe);
  const firstOpen = Math.ceil(from / step) * step;
  const expectedCandles = Math.max(0, Math.ceil((to - firstOpen) / step));
  const actualTimes = new Set(
    candles
      .filter(
        (candle) =>
          candle.symbol === symbol &&
          candle.tf === timeframe &&
          candle.openTime >= firstOpen &&
          candle.openTime < to &&
          (candle.openTime - firstOpen) % step === 0,
      )
      .map((candle) => candle.openTime),
  );
  const missingTimestamps: number[] = [];
  for (
    let timestamp = firstOpen;
    timestamp < to && missingTimestamps.length < 5;
    timestamp += step
  ) {
    if (!actualTimes.has(timestamp)) missingTimestamps.push(timestamp);
  }
  const missingCandles = expectedCandles - actualTimes.size;
  return {
    complete: missingCandles === 0,
    expectedCandles,
    actualCandles: actualTimes.size,
    missingCandles,
    ...(missingTimestamps.length ? { missingTimestamps } : {}),
  };
}
