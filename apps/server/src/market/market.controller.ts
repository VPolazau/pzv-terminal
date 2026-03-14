import { Controller, Get, Query } from "@nestjs/common";
import type { Ticker } from "@pzv-terminal/shared-types";
import { redisGetString } from "@pzv-terminal/core-redis";

@Controller("market")
export class MarketController {
  @Get("ticker")
  async ticker(@Query("symbol") symbol = "BTCUSDT"): Promise<Ticker> {
    const key = `market:ticker:${symbol}`;
    const raw = await redisGetString(key);

    if (raw) return JSON.parse(raw) as Ticker;

    return {
      symbol,
      price: 65000,
      ts: Date.now(),
      source: "mock",
    };
  }
}
