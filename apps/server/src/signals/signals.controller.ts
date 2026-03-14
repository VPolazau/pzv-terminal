import { Controller, Get, Query } from "@nestjs/common";
import type { Candle, Timeframe } from "@pzv-terminal/shared-types";
import { connectRedis, getJson } from "@pzv-terminal/core-redis";
import { smaAt } from "@pzv-terminal/shared-utils";

type CrossSignal = "bull_cross" | "bear_cross" | "none";

@Controller("signals")
export class SignalsController {
  @Get("sma-cross")
  async smaCross(
    @Query("symbol") symbol = "BTCUSDT",
    @Query("tf") tf: Timeframe = "1m",
    @Query("fast") fastStr = "10",
    @Query("slow") slowStr = "50"
  ) {
    const fast = Math.max(1, Math.min(200, Number(fastStr) || 10));
    const slow = Math.max(2, Math.min(500, Number(slowStr) || 50));

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

    let signal: CrossSignal = "none";
    if (
      nowFast !== null &&
      nowSlow !== null &&
      prevFast !== null &&
      prevSlow !== null
    ) {
      if (prevFast <= prevSlow && nowFast > nowSlow) signal = "bull_cross";
      else if (prevFast >= prevSlow && nowFast < nowSlow) signal = "bear_cross";
    }

    return {
      symbol,
      tf,
      fast,
      slow,
      signal,
      now: { fast: nowFast, slow: nowSlow },
      prev: { fast: prevFast, slow: prevSlow },
      candlesCount: candles.length,
      ts: Date.now(),
    };
  }
}
