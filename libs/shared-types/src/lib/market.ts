export type Symbol = string;

export type Ticker = {
  symbol: Symbol;
  price: number; // текущая цена
  ts: number; // timestamp (ms)
  source: "mock" | "binance" | "mexc";
};
