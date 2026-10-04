import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import type { BacktestStrategy } from './strategy';

export type BacktestConfig = {
  symbol: string;
  timeframe: Timeframe;
  from: number;
  to: number;
  initialBalance: number;
  feeRate: number;
  slippageRate: number;
};

export type BacktestTrade = {
  sequence: number;
  symbol: string;
  timeframe: Timeframe;
  entrySignalTime: number;
  entryTime: number;
  entryPrice: number;
  exitSignalTime: number | null;
  exitTime: number;
  exitPrice: number;
  quantity: number;
  entryFee: number;
  exitFee: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  exitReason: 'SIGNAL' | 'END_OF_PERIOD';
};

export type EquityPoint = { timestamp: number; equity: number };

export type BacktestMetrics = {
  initialBalance: number;
  finalBalance: number;
  finalEquity: number;
  netProfit: number;
  returnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  totalFees: number;
};

export type BacktestResult = {
  config: BacktestConfig & { strategyId: string };
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
};

type Position = {
  quantity: number;
  entryPrice: number;
  entryFee: number;
  entrySignalTime: number;
  entryTime: number;
};

export function runBacktest(
  config: BacktestConfig,
  candles: readonly Candle[],
  strategy: BacktestStrategy,
): BacktestResult {
  validateConfig(config);
  const availableCandles = candles
    .filter(
      (candle) =>
        candle.symbol === config.symbol &&
        candle.tf === config.timeframe &&
        candle.openTime < config.to,
    )
    .sort((a, b) => a.openTime - b.openTime);
  const periodCandles = availableCandles.filter(
    (candle) => candle.openTime >= config.from,
  );

  let quoteBalance = config.initialBalance;
  let position: Position | null = null;
  let pending: { decision: 'BUY' | 'SELL'; signalTime: number } | null = null;
  let sequence = 0;
  const trades: BacktestTrade[] = [];
  const executionCandles = new Set<number>();
  const equityCurve: EquityPoint[] = [
    { timestamp: config.from, equity: config.initialBalance },
  ];

  for (let i = 0; i < availableCandles.length; i++) {
    const candle = availableCandles[i];
    const inEvaluationPeriod = candle.openTime >= config.from;
    if (!inEvaluationPeriod) continue;
    if (pending) {
      if (
        pending.decision === 'BUY' &&
        !position &&
        !executionCandles.has(candle.openTime)
      ) {
        const entryPrice = candle.open * (1 + config.slippageRate);
        const quantity = quoteBalance / (entryPrice * (1 + config.feeRate));
        const entryFee = quantity * entryPrice * config.feeRate;
        position = {
          quantity,
          entryPrice,
          entryFee,
          entrySignalTime: pending.signalTime,
          entryTime: candle.openTime,
        };
        quoteBalance = 0;
        executionCandles.add(candle.openTime);
      } else if (
        pending.decision === 'SELL' &&
        position &&
        !executionCandles.has(candle.openTime)
      ) {
        const trade = closePosition(
          position,
          candle.open * (1 - config.slippageRate),
          candle.openTime,
          pending.signalTime,
          'SIGNAL',
          config,
          ++sequence,
        );
        quoteBalance +=
          trade.netPnl +
          position.quantity * position.entryPrice +
          position.entryFee;
        trades.push(trade);
        position = null;
        executionCandles.add(candle.openTime);
      }
      pending = null;
    }

    const history = availableCandles.slice(0, i + 1);
    const decision = strategy.evaluate({ history, currentIndex: i });
    if (decision !== 'HOLD')
      pending = { decision, signalTime: candle.closeTime };

    const equity = position
      ? quoteBalance + position.quantity * candle.close
      : quoteBalance;
    equityCurve.push({ timestamp: candle.closeTime, equity });
  }

  if (position && periodCandles.length > 0) {
    const last = periodCandles[periodCandles.length - 1];
    const trade = closePosition(
      position,
      last.close * (1 - config.slippageRate),
      last.closeTime,
      null,
      'END_OF_PERIOD',
      config,
      ++sequence,
    );
    quoteBalance +=
      trade.netPnl +
      position.quantity * position.entryPrice +
      position.entryFee;
    trades.push(trade);
    equityCurve[equityCurve.length - 1] = {
      timestamp: last.closeTime,
      equity: quoteBalance,
    };
  }

  const metrics = calculateMetrics(config, quoteBalance, trades, equityCurve);
  return {
    config: { ...config, strategyId: strategy.id },
    metrics,
    trades,
    equityCurve,
  };
}

function closePosition(
  position: Position,
  exitPrice: number,
  exitTime: number,
  exitSignalTime: number | null,
  exitReason: BacktestTrade['exitReason'],
  config: BacktestConfig,
  sequence: number,
): BacktestTrade {
  const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
  const exitFee = exitPrice * position.quantity * config.feeRate;
  const fees = position.entryFee + exitFee;
  const netPnl = grossPnl - fees;
  const entryCost = position.entryPrice * position.quantity + position.entryFee;
  return {
    sequence,
    symbol: config.symbol,
    timeframe: config.timeframe,
    entrySignalTime: position.entrySignalTime,
    entryTime: position.entryTime,
    entryPrice: position.entryPrice,
    exitSignalTime,
    exitTime,
    exitPrice,
    quantity: position.quantity,
    entryFee: position.entryFee,
    exitFee,
    grossPnl,
    fees,
    netPnl,
    returnPct: entryCost === 0 ? 0 : (netPnl / entryCost) * 100,
    exitReason,
  };
}

function calculateMetrics(
  config: BacktestConfig,
  finalBalance: number,
  trades: readonly BacktestTrade[],
  equityCurve: readonly EquityPoint[],
): BacktestMetrics {
  const winners = trades.filter((trade) => trade.netPnl > 0);
  const losers = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = trades
    .filter((trade) => trade.grossPnl > 0)
    .reduce((sum, trade) => sum + trade.grossPnl, 0);
  const grossLoss = trades
    .filter((trade) => trade.grossPnl < 0)
    .reduce((sum, trade) => sum + Math.abs(trade.grossPnl), 0);
  let peak = config.initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak - point.equity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPct = Math.max(
      maxDrawdownPct,
      peak === 0 ? 0 : (drawdown / peak) * 100,
    );
  }
  const netProfit = finalBalance - config.initialBalance;
  return {
    initialBalance: config.initialBalance,
    finalBalance,
    finalEquity: finalBalance,
    netProfit,
    returnPct: (netProfit / config.initialBalance) * 100,
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate:
      trades.length === 0 ? null : (winners.length / trades.length) * 100,
    grossProfit,
    grossLoss,
    averageWin:
      winners.length === 0
        ? null
        : winners.reduce((sum, trade) => sum + trade.netPnl, 0) /
          winners.length,
    averageLoss:
      losers.length === 0
        ? null
        : losers.reduce((sum, trade) => sum + trade.netPnl, 0) / losers.length,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    maxDrawdown,
    maxDrawdownPct,
    totalFees: trades.reduce((sum, trade) => sum + trade.fees, 0),
  };
}

function validateConfig(config: BacktestConfig): void {
  if (!Number.isFinite(config.initialBalance) || config.initialBalance <= 0)
    throw new Error('initialBalance must be positive');
  if (!Number.isFinite(config.feeRate) || config.feeRate < 0)
    throw new Error('feeRate must be non-negative');
  if (!Number.isFinite(config.slippageRate) || config.slippageRate < 0)
    throw new Error('slippageRate must be non-negative');
  if (config.from >= config.to) throw new Error('from must be earlier than to');
}
