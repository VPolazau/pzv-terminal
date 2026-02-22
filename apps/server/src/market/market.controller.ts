import { Controller, Get, Query } from "@nestjs/common";
import type { Ticker } from "@pzv-terminal/shared-types";

@Controller("market")
export class MarketController {
  @Get("ticker")
  ticker(@Query("symbol") symbol = "BTCUSDT"): Ticker {
    return {
      symbol,
      price: 65000,
      ts: Date.now(),
      source: "mock",
    };
  }
}
