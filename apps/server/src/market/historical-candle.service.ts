import { Inject, Injectable } from '@nestjs/common';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import {
  fetchBinanceHistoricalKlines,
  timeframeMs,
} from '@pzv-terminal/shared-utils';
import { HistoricalCandleRepository } from './historical-candle.repository';

type HistoricalFetcher = (params: {
  symbol: string;
  tf: Timeframe;
  from: number;
  to: number;
}) => Promise<Candle[]>;

export const HISTORICAL_CANDLE_FETCHER = Symbol('HISTORICAL_CANDLE_FETCHER');

@Injectable()
export class HistoricalCandleService {
  constructor(
    private readonly repository: HistoricalCandleRepository,
    @Inject(HISTORICAL_CANDLE_FETCHER)
    private readonly fetcher: HistoricalFetcher = fetchBinanceHistoricalKlines,
  ) {}

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    const step = timeframeMs(timeframe);
    const firstOpen = Math.ceil(from / step) * step;
    const stored = new Set(
      this.repository.findOpenTimes(symbol, timeframe, from, to),
    );
    let gapStart: number | null = null;

    for (let openTime = firstOpen; openTime < to; openTime += step) {
      const exists = stored.has(openTime);
      if (!exists && gapStart === null) gapStart = openTime;
      if ((exists || openTime + step >= to) && gapStart !== null) {
        const gapEnd = exists ? openTime : openTime + step;
        const fetched = await this.fetcher({
          symbol,
          tf: timeframe,
          from: gapStart,
          to: gapEnd,
        });
        this.repository.saveCandles(fetched);
        gapStart = null;
      }
    }

    return this.repository.findCandles(symbol, timeframe, from, to);
  }
}
