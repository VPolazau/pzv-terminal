import { MONITORING_STRATEGY as strategy } from '@pzv-terminal/core-config';
import { Controller, Get, Query } from '@nestjs/common';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import { connectRedis, getJson } from '@pzv-terminal/core-redis';
import { smaAt } from '@pzv-terminal/shared-utils';
import { parseSmaPeriod } from '../indicators/parse-sma-period';

type CrossSignal = 'bull_cross' | 'bear_cross' | 'none';

@Controller('signals')
export class SignalsController {
  @Get('sma-cross')
  async smaCross(
    @Query('symbol') symbol: string = strategy.symbols[0],
    @Query('tf') tf: Timeframe = strategy.timeframes[0],
    @Query('fast') fastStr = String(strategy.fast),
    @Query('slow') slowStr = String(strategy.slow),
  ) {
    const fast = parseSmaPeriod(fastStr, 'fast', 1, 200);
    const slow = parseSmaPeriod(slowStr, 'slow', 2, 500);

    const redis = await connectRedis();
    const candles =
      (await getJson<Candle[]>(redis, `market:candles:${symbol}:${tf}`)) ?? [];

    const closes = candles.map((c) => c.close);
    const lastIndex = closes.length - 1;
    const prevIndex = closes.length - 2;

    const nowFast = smaAt(closes, fast, lastIndex);
    const nowSlow = smaAt(closes, slow, lastIndex);
    const prevFast = smaAt(closes, fast, prevIndex);
    const prevSlow = smaAt(closes, slow, prevIndex);

    let signal: CrossSignal = 'none';
    if (
      nowFast !== null &&
      nowSlow !== null &&
      prevFast !== null &&
      prevSlow !== null
    ) {
      if (prevFast <= prevSlow && nowFast > nowSlow) signal = 'bull_cross';
      else if (prevFast >= prevSlow && nowFast < nowSlow) signal = 'bear_cross';
    }

    return {
      symbol,
      tf,
      fast,
      slow,
      signal,
      action:
        signal === 'bull_cross'
          ? 'BUY'
          : signal === 'bear_cross'
            ? 'SELL'
            : null,
      mode: 'closed' as const,
      now: { fast: nowFast, slow: nowSlow },
      prev: { fast: prevFast, slow: prevSlow },
      candlesCount: candles.length,
      ts: Date.now(),
    };
  }
}
