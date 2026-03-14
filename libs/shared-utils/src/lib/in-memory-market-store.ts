import type { Ticker } from '@pzv-terminal/shared-types';

let lastTicker: Ticker | null = null;

export function setLastTicker(t: Ticker) {
  lastTicker = t;
}

export function getLastTicker(): Ticker | null {
  return lastTicker;
}
