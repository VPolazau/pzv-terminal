import type { Candle } from '@pzv-terminal/shared-types';
import { smaCrossAt } from '../signals/sma-cross';
import type {
  BacktestStrategy,
  BacktestStrategyContext,
  StrategyDecision,
} from './strategy';

export class SmaCrossBacktestStrategy implements BacktestStrategy {
  readonly id = 'SMA_CROSS';

  constructor(
    readonly shortPeriod = 1,
    readonly longPeriod = 238,
  ) {
    if (
      !Number.isInteger(shortPeriod) ||
      !Number.isInteger(longPeriod) ||
      shortPeriod < 1 ||
      longPeriod < 1 ||
      shortPeriod > longPeriod
    ) {
      throw new Error('Invalid SMA strategy periods');
    }
  }

  evaluate(context: BacktestStrategyContext): StrategyDecision {
    const { history, currentIndex } = context;
    const cross = smaCrossAt({
      closes: history.map((candle: Candle) => candle.close),
      fast: this.shortPeriod,
      slow: this.longPeriod,
      index: currentIndex,
    });
    if (cross.signal === 'bull_cross') return 'BUY';
    if (cross.signal === 'bear_cross') return 'SELL';
    return 'HOLD';
  }
}
