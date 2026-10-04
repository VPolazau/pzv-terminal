import type { Candle } from '@pzv-terminal/shared-types';
import { SmaCrossBacktestStrategy } from './sma-cross.strategy';
import { runBacktest, type BacktestConfig } from './engine';
import type { BacktestStrategy, StrategyDecision } from './strategy';

const step = 60_000;
const baseConfig: BacktestConfig = {
  symbol: 'BTCUSDT',
  timeframe: '1m',
  from: 0,
  to: step * 4,
  initialBalance: 1_000,
  feeRate: 0,
  slippageRate: 0,
};

function candle(openTime: number, open: number, close = open): Candle {
  return {
    symbol: 'BTCUSDT',
    tf: '1m',
    openTime,
    closeTime: openTime + step - 1,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
    source: 'mock',
  };
}

function decisions(map: Record<number, StrategyDecision>): BacktestStrategy {
  return {
    id: 'TEST',
    evaluate: ({ history, currentIndex }) =>
      map[history[currentIndex].openTime] ?? 'HOLD',
  };
}

function run(
  strategy: BacktestStrategy,
  candles: Candle[],
  config = baseConfig,
) {
  return runBacktest(config, candles, strategy);
}

describe('backtest engine', () => {
  it('creates one trade for BUY then SELL and executes on next opens', () => {
    const result = run(decisions({ 0: 'BUY', [step]: 'SELL' }), [
      candle(0, 100),
      candle(step, 110),
      candle(step * 2, 120),
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entrySignalTime: step - 1,
      entryTime: step,
      entryPrice: 110,
      exitSignalTime: step * 2 - 1,
      exitTime: step * 2,
      exitPrice: 120,
      exitReason: 'SIGNAL',
    });
  });

  it('ignores BUY while long and SELL without a position', () => {
    const result = run(
      decisions({ 0: 'SELL', [step]: 'BUY', [step * 2]: 'BUY' }),
      [
        candle(0, 100),
        candle(step, 110),
        candle(step * 2, 120),
        candle(step * 3, 130),
      ],
    );
    expect(result.trades).toHaveLength(1);
  });

  it('charges fees on both sides', () => {
    const result = run(
      decisions({ 0: 'BUY', [step]: 'SELL' }),
      [candle(0, 100), candle(step, 100), candle(step * 2, 110)],
      { ...baseConfig, feeRate: 0.001 },
    );
    expect(result.trades[0].fees).toBeCloseTo(2.0979);
    expect(result.metrics.totalFees).toBeCloseTo(2.0979);
  });

  it('applies slippage against the position', () => {
    const result = run(
      decisions({ 0: 'BUY', [step]: 'SELL' }),
      [candle(0, 100), candle(step, 100), candle(step * 2, 110)],
      { ...baseConfig, slippageRate: 0.01 },
    );
    expect(result.trades[0].entryPrice).toBeCloseTo(101);
    expect(result.trades[0].exitPrice).toBeCloseTo(108.9);
  });

  it('does not use future candles when evaluating a decision', () => {
    const historyLengths: number[] = [];
    const strategy: BacktestStrategy = {
      id: 'NO_LOOKAHEAD',
      evaluate: ({ history, currentIndex }) => {
        historyLengths.push(history.length);
        expect(currentIndex).toBe(history.length - 1);
        return 'HOLD';
      },
    };
    run(strategy, [candle(0, 100), candle(step, 110), candle(step * 2, 120)]);
    expect(historyLengths).toEqual([1, 2, 3]);
  });

  it('does not execute a signal on the last candle', () => {
    const result = run(decisions({ 0: 'BUY' }), [candle(0, 100)]);
    expect(result.trades).toEqual([]);
  });

  it('marks an open position to market in the equity curve', () => {
    const result = run(decisions({ 0: 'BUY' }), [
      candle(0, 100),
      candle(step, 100, 120),
      candle(step * 2, 100, 110),
    ]);
    expect(result.equityCurve.map((point) => point.equity)).toEqual([
      1000, 1000, 1200, 1100,
    ]);
    expect(result.trades[0].exitReason).toBe('END_OF_PERIOD');
  });

  it('calculates max drawdown from marked-to-market equity', () => {
    const result = run(decisions({ 0: 'BUY' }), [
      candle(0, 100),
      candle(step, 100, 80),
      candle(step * 2, 100, 80),
    ]);
    expect(result.metrics.maxDrawdown).toBeCloseTo(200);
    expect(result.metrics.maxDrawdownPct).toBeCloseTo(20);
  });

  it('calculates winning/losing trades and profit factor', () => {
    const result = run(
      decisions({
        0: 'BUY',
        [step]: 'SELL',
        [step * 2]: 'BUY',
        [step * 3]: 'SELL',
      }),
      [
        candle(0, 100),
        candle(step, 110),
        candle(step * 2, 120),
        candle(step * 3, 90),
        candle(step * 4, 80),
      ],
      { ...baseConfig, to: step * 5 },
    );
    expect(result.metrics.totalTrades).toBe(2);
    expect(result.metrics.winningTrades).toBe(1);
    expect(result.metrics.losingTrades).toBe(1);
    expect(result.metrics.profitFactor).toBeGreaterThan(0);
  });

  it('returns null profit factor when there are no losses', () => {
    const result = run(decisions({ 0: 'BUY', [step]: 'SELL' }), [
      candle(0, 100),
      candle(step, 100),
      candle(step * 2, 120),
    ]);
    expect(result.metrics.profitFactor).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });

  it('uses warm-up candles for SMA without including them in evaluation PnL', () => {
    const result = run(
      new SmaCrossBacktestStrategy(1, 3),
      [
        candle(-step * 3, 100),
        candle(-step * 2, 100),
        candle(-step, 100),
        candle(0, 110),
        candle(step, 120),
      ],
      { ...baseConfig, to: step * 2 },
    );
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entrySignalTime).toBe(step - 1);
  });

  it('is deterministic for identical input', () => {
    const candles = [candle(0, 100), candle(step, 110), candle(step * 2, 120)];
    const first = run(decisions({ 0: 'BUY', [step]: 'SELL' }), candles);
    const second = run(decisions({ 0: 'BUY', [step]: 'SELL' }), candles);
    expect(second).toEqual(first);
  });
});
