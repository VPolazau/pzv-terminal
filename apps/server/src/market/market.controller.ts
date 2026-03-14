import { Controller, Get, Query } from "@nestjs/common";
import type { Candle, Timeframe } from "@pzv-terminal/shared-types";
import { connectRedis, getJson } from "@pzv-terminal/core-redis";

@Controller("market")
export class MarketController {
  @Get("candles")
  async candles(
    @Query("symbol") symbol = "BTCUSDT",
    @Query("tf") tf: Timeframe = "1m",
    @Query("limit") limitStr = "120"
  ): Promise<Candle[]> {
    const limit = Math.max(1, Math.min(1000, Number(limitStr) || 120));

    const redis = await connectRedis();
    const key = `market:candles:${symbol}:${tf}`;

    const data = await getJson<Candle[]>(redis, key);
    return data ? data.slice(-limit) : [];
  }
}
