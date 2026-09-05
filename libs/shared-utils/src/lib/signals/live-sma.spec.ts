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
