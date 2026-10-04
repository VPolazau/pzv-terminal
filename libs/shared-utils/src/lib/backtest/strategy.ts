import type { Candle } from '@pzv-terminal/shared-types';

export type StrategyDecision = 'BUY' | 'SELL' | 'HOLD';

export type BacktestStrategyContext = {
  /** History is intentionally limited to candles available through currentIndex. */
  history: readonly Candle[];
  currentIndex: number;
};

export interface BacktestStrategy {
  readonly id: string;
  evaluate(context: BacktestStrategyContext): StrategyDecision;
}
