export type Symbol = string;

export type Ticker = {
  symbol: Symbol;
  price: number; // текущая цена
  ts: number; // timestamp (ms)
  source: 'mock' | 'binance' | 'mexc' | 'bybit';
};

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type Candle = {
  symbol: Symbol;
  tf: Timeframe;

  openTime: number; // ms
  closeTime: number; // ms

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
  source: Ticker['source'];
};

export type SmaCrossSignal = 'bull_cross' | 'bear_cross' | 'none';

export type SignalEvent = {
  type: 'sma_cross';
  symbol: string;
  tf: Timeframe;
  fast: number;
  slow: number;
  signal: Exclude<SmaCrossSignal, 'none'>;
  ts: number;
  now: { fast: number; slow: number };
  prev: { fast: number; slow: number };
};
