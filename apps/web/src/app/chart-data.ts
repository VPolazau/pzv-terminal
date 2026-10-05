import type {
  CandlestickData,
  SeriesMarker,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './api/market.api';
import type { LiveSignalRecord } from './api/signals.api';
import type { SignalEvent } from './signal-events';

export const CHART_PAGE_SIZE = 800;
export const MIN_FOCUS_BARS = 40;
export type TimeRange = { from: number; to: number }; // milliseconds, [from, to)
export type LogicalRange = { from: number; to: number };

export function timeframeMs(timeframe: string): number {
  const steps: Record<string, number> = {
    '1m': 60_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
  };
  const step = steps[timeframe];
  if (!step) throw new Error(`Unsupported chart timeframe: ${timeframe}`);
  return step;
}

export const candleOpenTime = (timestamp: number, timeframe: string) =>
  Math.floor(timestamp / timeframeMs(timeframe)) * timeframeMs(timeframe);
export const chartTime = (timestamp: number) =>
  (timestamp / 1000) as UTCTimestamp;

const sameCandle = (a: Candle, b: Candle) =>
  a.openTime === b.openTime &&
  a.closeTime === b.closeTime &&
  a.symbol === b.symbol &&
  a.tf === b.tf &&
  a.open === b.open &&
  a.high === b.high &&
  a.low === b.low &&
  a.close === b.close &&
  a.volume === b.volume;

/** Closed candles are immutable. Overlap/empty pages retain the array identity. */
export function mergeCandles(current: Candle[], incoming: Candle[]): Candle[] {
  const byTime = new Map(current.map((candle) => [candle.openTime, candle]));
  let changed = false;
  for (const candle of incoming) {
    const previous = byTime.get(candle.openTime);
    if (!previous || !sameCandle(previous, candle)) {
      byTime.set(candle.openTime, candle);
      changed = true;
    }
  }
  return changed
    ? [...byTime.values()].sort((a, b) => a.openTime - b.openTime)
    : current;
}

export function mergeSignals(
  current: LiveSignalRecord[],
  incoming: LiveSignalRecord[],
) {
  const records = new Map(current.map((signal) => [signal.id, signal]));
  for (const signal of incoming) records.set(signal.id, signal);
  return [...records.values()].sort(
    (a, b) => a.signalTime - b.signalTime || a.id.localeCompare(b.id),
  );
}

export function insertedLeftCount(previous: Candle[], next: Candle[]): number {
  return previous.length
    ? next.filter((candle) => candle.openTime < previous[0].openTime).length
    : 0;
}

/** Preserve a real bar's x coordinate AND fractional bar spacing; never round to times. */
export function preservedLogicalRange(
  previous: Candle[],
  next: Candle[],
  range: LogicalRange | null,
) {
  if (!range || !previous.length) return null;
  const index = Math.max(
    0,
    Math.min(previous.length - 1, Math.round(range.to)),
  );
  const newIndex = next.findIndex(
    (candle) => candle.openTime === previous[index].openTime,
  );
  if (newIndex < 0) return null;
  const shift = newIndex - index;
  return { from: range.from + shift, to: range.to + shift };
}

export function sameLogicalRange(
  a: LogicalRange | null,
  b: LogicalRange | null,
) {
  return (
    !!a &&
    !!b &&
    Math.abs(a.from - b.from) < 1e-7 &&
    Math.abs(a.to - b.to) < 1e-7
  );
}

export function toChartCandles(
  candles: Candle[],
): CandlestickData<UTCTimestamp>[] {
  return candles.map(({ openTime, open, high, low, close }) => ({
    time: chartTime(openTime),
    open,
    high,
    low,
    close,
  }));
}

export function buildMarkers(
  candles: Candle[],
  events: SignalEvent[],
  signals: LiveSignalRecord[],
  timeframe: string,
): SeriesMarker<UTCTimestamp>[] {
  if (!candles.length) return [];
  const symbol = candles[0].symbol;
  const times = new Set(candles.map((candle) => candle.openTime));
  const live: SignalEvent[] = signals.map((signal) => ({
    id: `LIVE:${signal.id}`,
    symbol: signal.symbol,
    timeframe: signal.tf,
    action: signal.action,
    timestamp: signal.signalTime,
    time: signal.signalTime,
    price: signal.price,
    source: 'LIVE',
    fee: null,
    profit: null,
  }));
  // Match the presentation layer's exact-event dedupe, not one marker per candle.
  // Historical wins an exact overlap; distinct BUY/SELL on a legacy candle survive.
  const unique = new Map<string, SignalEvent>();
  for (const event of [...events, ...live].sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.source.localeCompare(b.source) ||
      a.action.localeCompare(b.action) ||
      a.id.localeCompare(b.id),
  )) {
    if (
      event.symbol !== symbol ||
      event.timeframe !== timeframe ||
      !Number.isFinite(event.timestamp)
    )
      continue;
    const time = candleOpenTime(event.timestamp, timeframe);
    if (!times.has(time)) continue;
    const key = `${event.timestamp}:${event.action}`;
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()].map((event) => ({
    id: event.id,
    time: chartTime(candleOpenTime(event.timestamp, timeframe)),
    position: event.action === 'BUY' ? 'belowBar' : 'aboveBar',
    color: event.action === 'BUY' ? '#198754' : '#c43d54',
    shape: event.action === 'BUY' ? 'arrowUp' : 'arrowDown',
    text: `${event.action} · ${event.source === 'HISTORICAL' ? 'H' : 'L'}`,
    size: 1,
  }));
}

export function selectionBounds(event: SignalEvent, timeframe: string) {
  const trade =
    event.source === 'HISTORICAL' &&
    Number.isFinite(event.entryTime) &&
    Number.isFinite(event.exitTime);
  const start = candleOpenTime(
    trade ? Math.min(event.entryTime, event.exitTime) : event.timestamp,
    timeframe,
  );
  const end = candleOpenTime(
    trade ? Math.max(event.entryTime, event.exitTime) : event.timestamp,
    timeframe,
  );
  return { start, end };
}

function focusPadding(bars: number) {
  return Math.max(5, Math.ceil(bars * 0.1), (MIN_FOCUS_BARS - bars) / 2);
}

export function selectionLoadRange(
  event: SignalEvent,
  timeframe: string,
): TimeRange {
  const { start, end } = selectionBounds(event, timeframe);
  const step = timeframeMs(timeframe);
  const padding = Math.ceil(focusPadding((end - start) / step + 1));
  return { from: start - padding * step, to: end + (padding + 1) * step };
}

export function selectionLogicalRange(
  event: SignalEvent,
  candles: Candle[],
  timeframe: string,
): LogicalRange | null {
  const { start, end } = selectionBounds(event, timeframe);
  const first = candles.findIndex((candle) => candle.openTime === start);
  const last = candles.findIndex((candle) => candle.openTime === end);
  if (first < 0 || last < 0) return null;
  const padding = focusPadding(last - first + 1);
  return { from: first - padding, to: last + padding };
}

/** Targeted loads can create separate islands. Page at the left edge of that island. */
export function olderBoundary(
  candles: Candle[],
  visibleFrom: number,
  timeframe: string,
) {
  if (!candles.length) return null;
  const index = Math.max(
    0,
    Math.min(candles.length - 1, Math.floor(visibleFrom)),
  );
  let first = index;
  const step = timeframeMs(timeframe);
  while (
    first > 0 &&
    candles[first].openTime - candles[first - 1].openTime === step
  )
    first--;
  return visibleFrom - first <= 40 ? candles[first].openTime : null;
}

export function mergeCoverage(
  ranges: TimeRange[],
  added: TimeRange,
): TimeRange[] {
  const result: TimeRange[] = [];
  for (const range of [...ranges, added].sort((a, b) => a.from - b.from)) {
    const last = result[result.length - 1];
    if (last && last.to >= range.from) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
  }
  return result;
}

export function uncoveredRanges(
  range: TimeRange,
  coverage: TimeRange[],
): TimeRange[] {
  let from = range.from;
  const missing: TimeRange[] = [];
  for (const covered of coverage) {
    if (covered.to <= from || covered.from >= range.to) continue;
    if (covered.from > from)
      missing.push({ from, to: Math.min(range.to, covered.from) });
    from = Math.max(from, covered.to);
  }
  if (from < range.to) missing.push({ from, to: range.to });
  return missing;
}
