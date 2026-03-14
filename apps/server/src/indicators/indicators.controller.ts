import { Controller, Get, Query } from "@nestjs/common";
import type { Candle, Timeframe } from "@pzv-terminal/shared-types";
import { connectRedis, getJson } from "@pzv-terminal/core-redis";
import { sma } from "@pzv-terminal/shared-utils";

@Controller("indicators")
export class IndicatorsController {
  @Get("sma")
  async getSma(
    @Query("symbol") symbol = "BTCUSDT",
    @Query("tf") tf: Timeframe = "1m",
    @Query("period") periodStr = "10"
  ) {
    const period = Math.max(1, Math.min(500, Number(periodStr) || 10));

    const redis = await connectRedis();
    const candles = (await getJson<Candle[]>(
      redis,
      `market:candles:${symbol}:${tf}`
    )) ?? [];

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
