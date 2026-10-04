import { request } from './http';

export type Candle = {
  symbol: string;
  tf: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export function getHistoricalCandles(
  symbol: string,
  timeframe: string,
  from: string,
  to: string,
) {
  const params = new URLSearchParams({ symbol, tf: timeframe, from, to });
  return request<Candle[]>(`/market/candles/history?${params.toString()}`);
}
