export type Symbol = string;

export type Ticker = {
  symbol: Symbol;
  price: number; // текущая цена
  ts: number; // timestamp (ms)
  source: 'mock' | 'binance' | 'mexc' | 'bybit';
};

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Candle = {
  symbol: Symbol;
  tf: Timeframe;

  openTime: number;  // ms
  closeTime: number; // ms

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
  source: Ticker["source"];
};
