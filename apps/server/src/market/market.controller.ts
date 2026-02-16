import { Controller, Get, Query } from "@nestjs/common";

@Controller("market")
export class MarketController {
  @Get("ticker")
  ticker(@Query("symbol") symbol = "BTCUSDT") {
    // TODO: позже заменим на реальную биржу
    return {
      symbol,
      price: 65000,
      ts: Date.now(),
      source: "mock",
    };
  }
}
