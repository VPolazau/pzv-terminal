import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import { getJson } from '@pzv-terminal/core-redis';
import { sma } from '@pzv-terminal/shared-utils';
import { REDIS } from '../redis/redis.module';
import type { RedisClientType } from 'redis';
import { parseSmaPeriod } from './parse-sma-period';

@Controller('indicators')
export class IndicatorsController {
  constructor(@Inject(REDIS) private readonly redis: RedisClientType) {}

  @Get('sma')
  async getSma(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('tf') tf: Timeframe = '1m',
    @Query('period') periodStr = '10',
  ) {
    const s = String(symbol).trim().toUpperCase();
    const key = `market:candles:${s}:${tf}`;
    const period = parseSmaPeriod(periodStr, 'period', 1, 500);
    const candles = (await getJson<Candle[]>(this.redis, key)) ?? [];
    const closes = candles.map((c) => c.close);
    const value = sma(closes, period);

    return {
      symbol,
      tf,
      period,
      value,
      candlesCount: candles.length,
      ts: Date.now(),
    };
  }
}
