import {
  buildMarkers,
  candleOpenTime,
  CHART_PAGE_SIZE,
  insertedLeftCount,
  mergeCandles,
  mergeCoverage,
  olderBoundary,
  preservedLogicalRange,
  selectionLoadRange,
  selectionLogicalRange,
  timeframeMs,
  uncoveredRanges,
} from './chart-data';
import {
  normalizeRectangle,
  rectangleStyle,
  rectangleTrade,
} from './trade-rectangle';

import { base, candle, event, step } from './chart-test-fixtures';

describe('chart data', () => {
  it.each(['1m', '1h', '4h', '1d'])(
    'normalizes intrabar timestamps to UTC %s openTime',
    (tf) => {
      const timestamp = Date.parse('2025-02-03T07:38:59.999Z');
      const open = candleOpenTime(timestamp, tf);
      expect(open % timeframeMs(tf)).toBe(0);
      expect(open).toBeLessThanOrEqual(timestamp);
      expect(open + timeframeMs(tf)).toBeGreaterThan(timestamp);
    },
  );
  it('does not use local timezone boundaries', () => {
    expect(
      candleOpenTime(Date.parse('2025-01-01T03:59:59.999+03:00'), '4h'),
    ).toBe(base);
    expect(candleOpenTime(base - 1, '1d')).toBe(base - 86_400_000);
  });
  it('merges, dedupes, sorts and counts ONLY real new candles left of oldest', () => {
    const previous = [candle(2), candle(3)];
    const merged = mergeCandles(previous, [
      candle(3),
      candle(0),
      candle(1),
      candle(1),
      candle(4),
    ]);
    expect(merged.map((c) => c.openTime)).toEqual(
      [0, 1, 2, 3, 4].map((i) => candle(i).openTime),
    );
    expect(insertedLeftCount(previous, merged)).toBe(2);
    expect(previous).toEqual([candle(2), candle(3)]);
  });
  it('keeps the array identity for empty/duplicate pages, but accepts changed OHLC', () => {
    const original = [candle(1)];
    expect(mergeCandles(original, [])).toBe(original);
    expect(mergeCandles(original, [candle(1)])).toBe(original);
    expect(mergeCandles(original, [{ ...candle(1), close: 102 }])).not.toBe(
      original,
    );
  });
  it('preserves fractional logical range over three overlapping prepends', () => {
    let previous = Array.from({ length: 800 }, (_, i) => candle(2400 + i));
    let range = { from: 30.25, to: 100.75 };
    for (let page = 2; page >= 0; page--) {
      const next = mergeCandles(
        previous,
        Array.from({ length: 805 }, (_, i) => candle(page * 800 + i)),
      );
      const desired = preservedLogicalRange(previous, next, range);
      expect(desired).toEqual({ from: range.from + 800, to: range.to + 800 });
      expect(desired.to - desired.from).toBe(70.5);
      previous = next;
      range = desired;
    }
  });
  it('uses the anchor index for insertion into a previously targeted gap, not response size', () => {
    const previous = [candle(0), candle(1), candle(10), candle(11)];
    const next = mergeCandles(previous, [candle(5), candle(6)]);
    expect(insertedLeftCount(previous, next)).toBe(0);
    expect(
      preservedLogicalRange(previous, next, { from: 1.5, to: 3.5 }),
    ).toEqual({ from: 3.5, to: 5.5 });
    expect(preservedLogicalRange([], next, null)).toBeNull();
  });
  it('builds ASC markers only on existing candles, independently of table order/viewport', () => {
    const candles = [candle(0), candle(1), candle(2)];
    const events = [
      event(2),
      event(1, { timestamp: base + step + 10_000 }),
      event(0),
      event(3),
      event(1, { symbol: 'ETHUSDT' }),
    ];
    const markers = buildMarkers(candles, events, [], '1h');
    expect(markers.map((m) => m.time)).toEqual(
      [0, 1, 2].map((i) => candle(i).openTime / 1000),
    );
    expect(buildMarkers(candles, [...events].reverse(), [], '1h')).toEqual(
      markers,
    );
    expect(buildMarkers(candles, events, [], '4h')).toEqual([]);
  });
  it('merges paged live signals with historical events; does not discard legacy opposite actions', () => {
    const events = [event(0), event(0, { action: 'SELL', id: 'exit' })];
    const signals = [
      {
        id: 'live',
        symbol: 'BTCUSDT',
        tf: '1h',
        signalTime: base + step,
        price: 101,
        action: 'BUY' as const,
      },
    ];
    const markers = buildMarkers(
      [candle(0), candle(1)],
      events,
      [...signals, ...signals],
      '1h',
    );
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.text)).toEqual([
      'BUY · H',
      'SELL · H',
      'BUY · L',
    ]);
  });
  it('dedupes an exact historical/live boundary event deterministically', () => {
    const historical = event(0);
    const live = {
      id: 'live',
      symbol: 'BTCUSDT',
      tf: '1h',
      signalTime: base,
      action: 'BUY' as const,
      price: 100,
    };
    expect(buildMarkers([candle(0)], [historical], [live], '1h')).toHaveLength(
      1,
    );
    expect(buildMarkers([candle(0)], [historical], [live], '1h')[0].text).toBe(
      'BUY · H',
    );
  });
  it('keeps at least 40 bars for same-candle trades and LIVE events', () => {
    const candles = Array.from({ length: 100 }, (_, i) => candle(i));
    for (const selection of [
      event(50, {
        entryTime: candle(50).openTime,
        exitTime: candle(50).closeTime,
      }),
      event(50, { source: 'LIVE' }),
    ]) {
      const range = selectionLogicalRange(selection, candles, '1h');
      expect(range.to - range.from + 1).toBe(40);
      expect(range.from).toBeLessThan(50);
      expect(range.to).toBeGreaterThan(50);
    }
  });
  it('includes the entire long trade + padding in load and focus ranges', () => {
    const selection = event(10, {
      entryTime: candle(10).openTime,
      exitTime: candle(900).closeTime,
    });
    const range = selectionLoadRange(selection, '1h');
    expect(range.from).toBeLessThan(candle(10).openTime);
    expect(range.to).toBeGreaterThan(candle(900).closeTime);
    expect(selectionLogicalRange(selection, [candle(10)], '1h')).toBeNull();
    const focus = selectionLogicalRange(
      selection,
      Array.from({ length: 1000 }, (_, i) => candle(i)),
      '1h',
    );
    expect(focus.from).toBeLessThan(10);
    expect(focus.to).toBeGreaterThan(900);
  });
  it('tracks coverage separately from actual data, including empty pages', () => {
    const ranges = mergeCoverage([{ from: 10, to: 20 }], { from: 0, to: 10 });
    expect(ranges).toEqual([{ from: 0, to: 20 }]);
    expect(uncoveredRanges({ from: -10, to: 30 }, ranges)).toEqual([
      { from: -10, to: 0 },
      { from: 20, to: 30 },
    ]);
    expect(uncoveredRanges({ from: 5, to: 15 }, ranges)).toEqual([]);
  });
  it('finds the older edge of a targeted island rather than the global oldest candle', () => {
    const candles = [
      candle(0),
      candle(1),
      ...Array.from({ length: CHART_PAGE_SIZE }, (_, i) => candle(1000 + i)),
    ];
    expect(olderBoundary(candles, 2.5, '1h')).toBe(candle(1000).openTime);
    expect(olderBoundary(candles, 90, '1h')).toBeNull();
  });
});

describe('trade rectangle', () => {
  it('normalizes falling trades and skips null/non-finite coordinates', () => {
    expect(normalizeRectangle(20, 10, 40, 5)).toEqual({
      left: 10,
      right: 20,
      top: 5,
      bottom: 40,
    });
    expect(normalizeRectangle(null, 10, 40, 5)).toBeNull();
    expect(normalizeRectangle(0, 10, NaN, 5)).toBeNull();
  });
  it('uses cyan for zero/positive net PnL and red for negative', () => {
    expect(rectangleStyle(0)).toEqual(rectangleStyle(1));
    expect(rectangleStyle(-1)).not.toEqual(rectangleStyle(1));
    expect(rectangleStyle(-1).fill).toContain('0.16');
  });
  it('does not draw LIVE/incomplete/no selections', () => {
    const trade = event(0, {
      entryTime: base,
      exitTime: base + step,
      entryPrice: 100,
      exitPrice: 110,
      netPnl: 8,
    });
    expect(rectangleTrade(trade)).toBe(trade);
    expect(rectangleTrade({ ...trade, source: 'LIVE' })).toBeNull();
    expect(rectangleTrade(event(0))).toBeNull();
    expect(rectangleTrade(null)).toBeNull();
  });
});
