export type SignalEvent = {
  id: string;
  symbol: string;
  timeframe: string;
  action: 'BUY' | 'SELL';
  timestamp: number;
  time: number;
  price: number;
  source: 'LIVE' | 'HISTORICAL';
  fee: number | null;
  profit: number | null;
  tradeId?: string;
  entryTime?: number;
  exitTime?: number;
  entryPrice?: number;
  exitPrice?: number;
  netPnl?: number;
};
