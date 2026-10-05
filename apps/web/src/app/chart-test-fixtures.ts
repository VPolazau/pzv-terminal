import type { Candle } from './api/market.api';
import type { SignalEvent } from './signal-events';

export const step = 3_600_000;
export const base = Date.parse('2025-01-01T00:00:00Z');
export const candle = (index: number): Candle => ({
  symbol: 'BTCUSDT',
  tf: '1h',
  openTime: base + index * step,
  closeTime: base + (index + 1) * step - 1,
  open: 100,
  high: 105,
  low: 95,
  close: 101,
  volume: 10,
});
export const event = (
  index: number,
  patch: Partial<SignalEvent> = {},
): SignalEvent => ({
  id: `historical:${index}`,
  symbol: 'BTCUSDT',
  timeframe: '1h',
  timestamp: base + index * step,
  time: base + index * step,
  action: 'BUY',
  price: 100,
  source: 'HISTORICAL',
  fee: 1,
  profit: null,
  ...patch,
});
