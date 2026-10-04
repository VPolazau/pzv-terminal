import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS } from '../redis/redis.module';
import { getJson } from '@pzv-terminal/core-redis';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import { parseHistoryRange } from './parse-history-range';
import { HistoricalCandleService } from './historical-candle.service';

@Controller('market')
export class MarketController {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClientType,
    private readonly historicalCandles: HistoricalCandleService,
  ) {}

  @Get('candles')
  async candles(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('tf') tf = '1m' as Timeframe,
    @Query('limit') limit = '200',
  ): Promise<Candle[]> {
    const s = String(symbol).trim().toUpperCase();
    const key = `market:candles:${s}:${tf}`;
    const candles = (await getJson<Candle[]>(this.redis, key)) ?? [];
    const n = Math.max(1, Math.min(Number(limit) || 200, candles.length));
    return candles.slice(-n);
  }

  @Get('candles/history')
  async candlesHistory(
    @Query('symbol') symbol?: string,
    @Query('tf') tf?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Candle[]> {
    const range = parseHistoryRange({ symbol, tf, from, to });
    return this.historicalCandles.getHistoricalCandles(
      range.symbol,
      range.tf,
      range.from,
      range.to,
    );
  }
}
