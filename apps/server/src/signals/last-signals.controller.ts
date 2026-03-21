import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { SignalEvent, Timeframe } from '@pzv-terminal/shared-types';
import { getJson } from '@pzv-terminal/core-redis';
import { REDIS } from '../redis/redis.module';
import type { RedisClientType } from 'redis';

@Controller('signals')
export class LastSignalsController {
  constructor(@Inject(REDIS) private readonly redis: RedisClientType) {}

  @Get('last')
  async last(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('tf') tf: Timeframe = '1m',
  ): Promise<SignalEvent | null> {
    const s = String(symbol).trim().toUpperCase();
    const key = `signals:last:sma_cross:${s}:${tf}`;
    const value = await getJson<SignalEvent>(this.redis, key);
    return value ?? null;
  }
}
