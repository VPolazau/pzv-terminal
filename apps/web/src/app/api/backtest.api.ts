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
    initialBalance: number;
    finalEquity: number;
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
  trades: Array<{
    sequence: number;
    symbol: string;
    timeframe: string;
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    entryFee: number;
    exitFee: number;
    quantity: number;
    netPnl: number;
    exitReason: string;
  }>;
  equityCurve: unknown[];
};
export type BacktestError = Error & { code?: string };
export function runBacktest(input: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  feeRate: number;
  initialBalance: number;
}) {
  return request<BacktestResponse>('/backtests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      strategy: { type: 'SMA_CROSS', shortPeriod: 1, longPeriod: 238 },
      initialBalance: input.initialBalance,
      feeRate: input.feeRate,
      slippageRate: 0,
    }),
  });
}
