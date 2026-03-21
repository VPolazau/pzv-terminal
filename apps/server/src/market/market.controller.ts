import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS } from '../redis/redis.module';
import { getJson } from '@pzv-terminal/core-redis';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';

@Controller('market')
export class MarketController {
  constructor(@Inject(REDIS) private readonly redis: RedisClientType) {}

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
}
