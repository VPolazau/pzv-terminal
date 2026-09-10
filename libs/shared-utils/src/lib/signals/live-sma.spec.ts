import { liveSmaTransition } from './live-sma';
import type { LiveSmaState } from '@pzv-terminal/shared-types';

const closes = Array(49).fill(100);
function calculate(price: number, previous: LiveSmaState | null = null) {
  const result = liveSmaTransition({
    closedCloses: closes,
    price,
    fast: 10,
    slow: 50,
    observedAt: 1,
    previous,
  });
  if (!result) throw new Error('Expected sufficient SMA history');
  return result;
}
describe('live SMA state machine', () => {
  it('initializes without an event and uses 9/49 closed closes plus current price', () => {
    const result = calculate(110);
    expect(result.signal).toBe('none');
    expect(result.state.now).toEqual({ fast: 101, slow: 100.2 });
    expect(closes).toEqual(Array(49).fill(100));
  });
  it('emits all three transitions bull -> bear -> bull in one candle', () => {
    let previous = calculate(90).state;
    const signals = [110, 90, 110].map((price) => {
      const result = calculate(price, previous);
      previous = result.state;
      return result.signal;
    });
    expect(signals).toEqual(['bull_cross', 'bear_cross', 'bull_cross']);
  });
  it('does not repeat the same directional state', () => {
    expect(calculate(120, calculate(110).state).signal).toBe('none');
    expect(calculate(80, calculate(90).state).signal).toBe('none');
  });
  it('preserves direction through equality', () => {
    const equal = calculate(100, calculate(90).state);
    expect(equal.signal).toBe('none');
    expect(equal.state.direction).toBe('below');
    expect(calculate(110, equal.state).signal).toBe('bull_cross');
    expect(
      calculate(90, calculate(100, calculate(110).state).state).signal,
    ).toBe('bear_cross');
  });
  it('initial equality establishes no direction and the first direction is silent', () => {
    const equal = calculate(100);
    expect(equal.state.direction).toBeNull();
    expect(calculate(110, equal.state).signal).toBe('none');
  });
  it('uses retained state after restart without repeating a delivered transition', () => {
    const saved = JSON.parse(JSON.stringify(calculate(110).state));
    expect(calculate(110, saved).signal).toBe('none');
    expect(calculate(90, saved).signal).toBe('bear_cross');
  });
  it('does not calculate with insufficient history or invalid price/period', () => {
    const params = {
      closedCloses: Array(48).fill(100),
      price: 110,
      fast: 10,
      slow: 50,
      observedAt: 1,
      previous: null,
    };
    expect(liveSmaTransition(params)).toBeNull();
    expect(
      liveSmaTransition({ ...params, closedCloses: closes, price: NaN }),
    ).toBeNull();
    expect(
      liveSmaTransition({ ...params, closedCloses: closes, fast: 10.5 }),
    ).toBeNull();
  });
});

describe('SMA1 / SMA238 intrabar calculation', () => {
  it('uses current price as SMA1 and exactly the last 237 closed closes as SMA238', () => {
    const last237 = Array.from({ length: 237 }, (_, i) => 100 + i);
    const closedCloses = [...Array(63).fill(99999), ...last237];
    const before = [...closedCloses];
    const result = liveSmaTransition({
      closedCloses,
      price: 400,
      fast: 1,
      slow: 238,
      observedAt: 1,
      previous: null,
    });
    expect(result?.state.now.fast).toBe(400);
    expect(result?.state.now.slow).toBe(
      (last237.reduce((a, b) => a + b, 0) + 400) / 238,
    );
    expect(closedCloses).toEqual(before);
    expect(result?.signal).toBe('none');
  });
  it('requires at least 237 closed candles', () => {
    expect(
      liveSmaTransition({
        closedCloses: Array(236).fill(100),
        price: 110,
        fast: 1,
        slow: 238,
        observedAt: 1,
        previous: null,
      }),
    ).toBeNull();
  });
  it('keeps equality directional and emits BUY/SELL/BUY technical transitions without cooldown', () => {
    let previous: LiveSmaState | null = null;
    const signals = [90, 90, 100, 110, 110, 100, 90, 110].map((price) => {
      const result = liveSmaTransition({
        closedCloses: Array(237).fill(100),
        price,
        fast: 1,
        slow: 238,
        observedAt: 1,
        previous,
      });
      if (!result) throw new Error('Expected result');
      previous = result.state;
      return result.signal;
    });
    expect(signals).toEqual([
      'none',
      'none',
      'none',
      'bull_cross',
      'none',
      'none',
      'bear_cross',
      'bull_cross',
    ]);
  });
});
