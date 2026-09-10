// The active strategy. Adding a symbol requires changing only this list.
export const MONITORING_STRATEGY = {
  symbols: ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'TAOUSDT'],
  timeframes: ['4h', '1d'],
  fast: 1,
  slow: 238,
  historyLimit: 300,
  historyTtlSeconds: {
    '1m': 2 * 86400,
    '4h': 180 * 86400,
    '1d': 365 * 86400,
  },
} as const;
