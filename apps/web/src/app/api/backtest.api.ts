import { request } from './http';
export type BacktestResponse = {
  config: {
    symbol: string;
    timeframe: string;
    from: number;
    to: number;
    strategyId: string;
  };
  metrics: {
    totalTrades: number;
    winRate: number | null;
    returnPct: number;
    netProfit: number;
    profitFactor: number | null;
    maxDrawdownPct: number;
    totalFees: number;
  };
  dataQuality: {
    complete: boolean;
    expectedCandles: number;
    actualCandles: number;
    missingCandles: number;
  };
  trades: unknown[];
  equityCurve: unknown[];
};
export type BacktestError = Error & { code?: string };
export function runBacktest(input: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
}) {
  return request<BacktestResponse>('/backtests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      strategy: { type: 'SMA_CROSS', shortPeriod: 1, longPeriod: 238 },
      initialBalance: 10000,
      feeRate: 0.001,
      slippageRate: 0,
    }),
  });
}
