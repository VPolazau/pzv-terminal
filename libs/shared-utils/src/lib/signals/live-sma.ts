import type { LiveSmaState, SmaCrossSignal } from '@pzv-terminal/shared-types';
import { sma } from '../indicators/sma';

export function liveSmaTransition(params: {
  closedCloses: number[];
  price: number;
  fast: number;
  slow: number;
  observedAt: number;
  previous: LiveSmaState | null;
}): { state: LiveSmaState; signal: SmaCrossSignal } | null {
  const { closedCloses, price, fast, slow, observedAt, previous } = params;
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    closedCloses.some((value) => !Number.isFinite(value) || value <= 0)
  )
    return null;
  const values = [...closedCloses, price];
  const fastValue = sma(values, fast);
  const slowValue = sma(values, slow);
  if (fastValue === null || slowValue === null) return null;
  const direction =
    fastValue > slowValue
      ? 'above'
      : fastValue < slowValue
        ? 'below'
        : (previous?.direction ?? null);
  const signal =
    previous?.direction && direction && direction !== previous.direction
      ? direction === 'above'
        ? 'bull_cross'
        : 'bear_cross'
      : 'none';
  return {
    state: { direction, now: { fast: fastValue, slow: slowValue }, observedAt },
    signal,
  };
}
