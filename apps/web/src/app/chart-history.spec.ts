import { ChartHistory } from './chart-history';
import { base, candle, event, step } from './chart-test-fixtures';
import type { Candle } from './api/market.api';

function setup(count = 4000) {
  const candles = jest.fn(
    async (
      _symbol: string,
      _tf: string,
      from: string,
      to: string,
      _signal?: AbortSignal,
    ) => {
      if (_signal?.aborted) throw new Error('Aborted');
      const start = Math.ceil((Date.parse(from) - base) / step);
      const end = Math.ceil((Date.parse(to) - base) / step);
      return Array.from({ length: end - start }, (_, i) => candle(start + i));
    },
  );
  const signals = jest.fn(async () => []);
  const publish = jest.fn();
  const session = new ChartHistory(
    'BTCUSDT',
    '1h',
    { from: base, to: base + count * step },
    publish,
    { candles, signals },
  );
  return { candles, signals, publish, session };
}

describe('chart request sessions (mock HTTP only)', () => {
  it('loads bounded LIVE context outside the backtest period only on selection', async () => {
    const s = setup(100);
    await s.session.initialize();
    expect(s.session.snapshot.candles).toHaveLength(100);
    await s.session.select(event(110, { source: 'LIVE' }));
    expect(
      s.session.snapshot.candles.some(
        (c) => c.openTime === candle(110).openTime,
      ),
    ).toBe(true);
    expect(s.session.snapshot.candles.length).toBeLessThanOrEqual(140);
    expect(s.session.snapshot.error).toBeNull();
  });
  it('splits saturated live-history pages without losing markers at the 500 record limit', async () => {
    const allCandles = Array.from({ length: 800 }, (_, i) => candle(i));
    const allSignals = allCandles.map((c, i) => ({
      id: String(i),
      symbol: 'BTCUSDT',
      tf: '1h',
      signalTime: c.openTime,
      price: 100,
      action: 'BUY' as const,
    }));
    const signals = jest.fn(
      async (_symbol: string, _tf: string, from: string, to: string) =>
        allSignals
          .filter(
            (signal) =>
              signal.signalTime >= Date.parse(from) &&
              signal.signalTime < Date.parse(to),
          )
          .slice(0, 500),
    );
    const session = new ChartHistory(
      'BTCUSDT',
      '1h',
      { from: base, to: base + 800 * step },
      () => undefined,
      { candles: async () => allCandles, signals },
    );
    await session.initialize();
    expect(session.snapshot.signals).toHaveLength(800);
    expect(signals).toHaveBeenCalledTimes(3);
  });
  it('initial load is bounded to 800 latest candles', async () => {
    const s = setup();
    await s.session.initialize();
    expect(s.candles).toHaveBeenCalledTimes(1);
    expect(s.session.snapshot.candles).toHaveLength(800);
    expect(s.session.snapshot.candles[0].openTime).toBe(candle(3200).openTime);
  });
  it('serializes initial/targeted/older, merges without lost updates, and reuses loaded selection', async () => {
    const s = setup();
    let finish: (data: Candle[]) => void = () => undefined;
    s.candles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const initial = s.session.initialize();
    const selection = s.session.select(
      event(50, {
        entryTime: candle(50).openTime,
        exitTime: candle(1100).closeTime,
      }),
    );
    await Promise.resolve();
    expect(s.candles).toHaveBeenCalledTimes(1);
    finish(Array.from({ length: 800 }, (_, i) => candle(3200 + i)));
    await initial;
    await selection;
    expect(
      s.session.snapshot.candles.some(
        (c) => c.openTime === candle(3999).openTime,
      ),
    ).toBe(true);
    expect(
      s.session.snapshot.candles.some(
        (c) => c.openTime === candle(1100).openTime,
      ),
    ).toBe(true);
    const calls = s.candles.mock.calls.length;
    await s.session.select(event(500));
    expect(s.candles).toHaveBeenCalledTimes(calls);
    await s.session.loadOlder(candle(3200).openTime);
    expect(
      new Set(s.session.snapshot.candles.map((c) => c.openTime)).size,
    ).toBe(s.session.snapshot.candles.length);
  });
  it('does not repeat an empty range or reinstall an unchanged dataset', async () => {
    const s = setup(2400);
    await s.session.initialize();
    const original = s.session.snapshot.candles;
    s.candles.mockResolvedValue([]);
    await s.session.loadOlder(original[0].openTime);
    const firstEmpty = s.candles.mock.calls[1][2];
    await s.session.loadOlder(original[0].openTime);
    expect(s.candles.mock.calls[2][2]).not.toBe(firstEmpty);
    await s.session.loadOlder(original[0].openTime);
    expect(s.candles).toHaveBeenCalledTimes(3);
    expect(s.session.snapshot.candles).toBe(original);
  });
  it('keeps a usable chart on error and retries only the failed range', async () => {
    const s = setup();
    await s.session.initialize();
    const original = s.session.snapshot.candles;
    s.candles.mockRejectedValueOnce(new Error('Offline'));
    await s.session.loadOlder(original[0].openTime);
    expect(s.session.snapshot.candles).toBe(original);
    expect(s.session.snapshot.error.message).toBe('Offline');
    await s.session.retry();
    expect(s.session.snapshot.candles).toHaveLength(1600);
    expect(s.session.snapshot.error).toBeNull();
    expect(s.candles.mock.calls[1].slice(0, 4)).toEqual(
      s.candles.mock.calls[2].slice(0, 4),
    );
  });
  it('aborts on close/filter change and ignores even a late successful response', async () => {
    const s = setup();
    let finish: (data: Candle[]) => void = () => undefined;
    s.candles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = s.session.initialize();
    await Promise.resolve();
    const abort = s.candles.mock.calls[0][4];
    s.session.dispose();
    const notifications = s.publish.mock.calls.length;
    finish([candle(3200)]);
    await request;
    expect(abort.aborted).toBe(true);
    expect(s.session.snapshot.candles).toEqual([]);
    expect(s.publish).toHaveBeenCalledTimes(notifications);
  });
  it('skips queued stale selections and never retries unavailable candles in a loop', async () => {
    const s = setup();
    await s.session.initialize();
    s.candles.mockResolvedValue([]);
    const stale = s.session.select(event(10));
    const current = s.session.select(event(100));
    await stale;
    await current;
    expect(s.candles).toHaveBeenCalledTimes(2);
    expect(s.session.snapshot.error.kind).toBe('selection');
    expect(s.session.snapshot.error.retryable).toBe(false);
    await s.session.select(event(100));
    expect(s.candles).toHaveBeenCalledTimes(2);
  });
  it('aborts an in-flight targeted load when a newer selection replaces it', async () => {
    const s = setup();
    await s.session.initialize();
    let finish: (data: Candle[]) => void = () => undefined;
    s.candles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stale = s.session.select(event(10));
    await Promise.resolve();
    const abort = s.candles.mock.calls[1][4];
    const current = s.session.select(event(100));
    expect(abort.aborted).toBe(true);
    finish([candle(10)]);
    await stale;
    await current;
    expect(
      s.session.snapshot.candles.some(
        (c) => c.openTime === candle(10).openTime,
      ),
    ).toBe(false);
    expect(
      s.session.snapshot.candles.some(
        (c) => c.openTime === candle(100).openTime,
      ),
    ).toBe(true);
    expect(s.session.snapshot.error).toBeNull();
  });
});
