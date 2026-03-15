import { Controller, Get, Query } from '@nestjs/common';
import type { SignalEvent, Timeframe } from '@pzv-terminal/shared-types';
import { connectRedis, getJson } from '@pzv-terminal/core-redis';

@Controller('signals')
export class LastSignalsController {
  @Get('last')
  async last(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('tf') tf: Timeframe = '1m',
  ): Promise<SignalEvent | null> {
    const redis = await connectRedis();
    const key = `signals:last:sma_cross:${symbol}:${tf}`;

    const value = await getJson<SignalEvent>(redis, key);
    return value ?? null;
  }
}
