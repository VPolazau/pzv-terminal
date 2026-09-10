export type Symbol = string;

export type Ticker = {
  symbol: Symbol;
  price: number; // текущая цена
  ts: number; // timestamp (ms)
  source: 'mock' | 'binance' | 'mexc' | 'bybit';
};

export type Timeframe = '1m' | '4h' | '1d';

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

export type ClosedSignalEvent = {
  type: 'sma_cross';
  symbol: string;
  tf: Timeframe;
  fast: number;
  slow: number;
  signal: Exclude<SmaCrossSignal, 'none'>;
  // Optional for compatibility with previously persisted events.
  action?: 'BUY' | 'SELL';
  suggestedStopLoss?: number;
  mode?: 'closed';
  ts: number;
  now: { fast: number; slow: number };
  prev: { fast: number; slow: number };
};

export type LiveSmaState = {
  direction: 'below' | 'above' | null;
  now: { fast: number; slow: number };
  observedAt: number;
};

export type LiveSignalEvent = Omit<ClosedSignalEvent, 'mode'> & {
  id: string;
  mode: 'live';
  source: 'binance';
  price: number;
  // Local receipt time: the REST price response has no exchange trade timestamp.
  observedAt: number;
  detectedAt: number;
  candleOpenTime: number;
  candleCloseTime: number;
};

export type SignalEvent = ClosedSignalEvent | LiveSignalEvent;
