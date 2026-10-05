import { request } from './http';
export type LiveSignalRecord = {
  id: string;
  symbol: string;
  tf: string;
  action: 'BUY' | 'SELL';
  signalTime: number;
  price: number;
};
export function getLatestSignal(symbol: string, tf: string) {
  return request<LiveSignalRecord | null>(
    `/signals/last?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`,
  );
}
export function getSignalHistory(symbol: string, tf: string) {
  return request<LiveSignalRecord[]>(
    `/signals/history?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=100&order=DESC`,
  );
}

export function getSignalHistoryRange(
  symbol: string,
  tf: string,
  from: string,
  to: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    symbol,
    tf,
    from,
    to,
    limit: '500',
    order: 'ASC',
  });
  return request<LiveSignalRecord[]>(`/signals/history?${params.toString()}`, {
    signal,
  });
}
