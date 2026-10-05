import { getHistoricalCandles, type Candle } from './api/market.api';
import {
  getSignalHistoryRange,
  type LiveSignalRecord,
} from './api/signals.api';
import type { SignalEvent } from './signal-events';
import {
  CHART_PAGE_SIZE,
  mergeCandles,
  mergeCoverage,
  mergeSignals,
  selectionLoadRange,
  selectionLogicalRange,
  timeframeMs,
  uncoveredRanges,
  type TimeRange,
} from './chart-data';

type Job = 'initial' | 'older' | 'selection';
export type ChartHistoryState = {
  candles: Candle[];
  signals: LiveSignalRecord[];
  coverage: TimeRange[];
  loading: Job | null;
  error: { kind: Job; message: string; retryable: boolean } | null;
};
export const emptyChartHistory = (): ChartHistoryState => ({
  candles: [],
  signals: [],
  coverage: [],
  loading: null,
  error: null,
});
type Loaders = {
  candles: typeof getHistoricalCandles;
  signals: typeof getSignalHistoryRange;
};

/** One disposable chart/filter session. No initial/older/targeted request can overwrite another. */
export class ChartHistory {
  private state = emptyChartHistory();
  private tail: Promise<unknown> = Promise.resolve();
  private controller: AbortController | null = null;
  private disposed = false;
  private selectionVersion = 0;
  private retryJob: (() => Promise<number>) | null = null;

  constructor(
    private symbol: string,
    private timeframe: string,
    private period: TimeRange,
    private publish: (state: ChartHistoryState) => void,
    private loaders: Loaders = {
      candles: getHistoricalCandles,
      signals: getSignalHistoryRange,
    },
  ) {}

  get snapshot() {
    return this.state;
  }

  initialize() {
    return this.enqueue('initial', () =>
      this.loadRange({
        from: Math.max(
          this.period.from,
          this.period.to - timeframeMs(this.timeframe) * CHART_PAGE_SIZE,
        ),
        to: this.period.to,
      }),
    );
  }

  loadOlder(anchor: number) {
    return this.enqueue('older', () => {
      const covered = this.state.coverage.find(
        (range) => range.from <= anchor && range.to > anchor,
      );
      const to = covered?.from ?? anchor;
      return this.loadRange({
        from: Math.max(
          this.period.from,
          to - timeframeMs(this.timeframe) * CHART_PAGE_SIZE,
        ),
        to,
      });
    });
  }

  select(event: SignalEvent | null) {
    const version = ++this.selectionVersion;
    if (this.state.loading === 'selection') this.controller?.abort();
    if (
      !event ||
      event.symbol !== this.symbol ||
      event.timeframe !== this.timeframe
    )
      return Promise.resolve(0);
    return this.enqueue(
      'selection',
      async () => {
        if (version !== this.selectionVersion) return 0;
        const result = await this.loadRange(this.rangeForSelection(event));
        if (
          version === this.selectionVersion &&
          !this.disposed &&
          !this.controller?.signal.aborted &&
          !selectionLogicalRange(event, this.state.candles, this.timeframe)
        ) {
          this.update({
            error: {
              kind: 'selection',
              retryable: false,
              message:
                'No closed candle is available for the selected event in this period.',
            },
          });
        }
        return result;
      },
      () => version === this.selectionVersion,
    );
  }

  selectionReady(event: SignalEvent | null) {
    return (
      !!event &&
      uncoveredRanges(this.rangeForSelection(event), this.state.coverage)
        .length === 0
    );
  }

  retry() {
    return this.retryJob?.() ?? Promise.resolve(0);
  }

  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.retryJob = null;
  }

  private clamp(range: TimeRange): TimeRange {
    return {
      from: Math.max(this.period.from, range.from),
      to: Math.min(this.period.to, range.to),
    };
  }

  private rangeForSelection(event: SignalEvent) {
    const range = selectionLoadRange(event, this.timeframe);
    // A live row may be newer than the evaluation period. Explicit selection loads
    // only its bounded context; historical selections stay within the backtest period.
    return event.source === 'LIVE' ? range : this.clamp(range);
  }

  private update(patch: Partial<ChartHistoryState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }

  private enqueue(
    kind: Job,
    task: () => Promise<number>,
    relevant = () => true,
  ): Promise<number> {
    const run = async () => {
      if (this.disposed || !relevant()) return 0;
      this.controller = new AbortController();
      const controller = this.controller;
      this.update({ loading: kind, error: null });
      try {
        const result = await task();
        if (!controller.signal.aborted) this.retryJob = null;
        return result;
      } catch (error) {
        if (!controller.signal.aborted && relevant() && !this.disposed) {
          this.retryJob = () => this.enqueue(kind, task, relevant);
          this.update({
            error: {
              kind,
              retryable: true,
              message:
                error instanceof Error
                  ? error.message
                  : 'Chart data request failed',
            },
          });
        }
        return 0;
      } finally {
        if (this.controller === controller) this.controller = null;
        this.update({ loading: null });
      }
    };
    const result = this.tail.then(run);
    this.tail = result;
    return result;
  }

  private async loadRange(requested: TimeRange) {
    if (
      !Number.isFinite(this.period.from) ||
      !Number.isFinite(this.period.to) ||
      this.period.from >= this.period.to
    ) {
      throw new Error('Choose a valid chart period.');
    }
    const controller = this.controller;
    if (!controller) return 0;
    const signal = controller.signal;
    const previousCount = this.state.candles.length;
    const step = timeframeMs(this.timeframe);
    for (const missing of uncoveredRanges(requested, this.state.coverage)) {
      for (
        let from = missing.from;
        from < missing.to;
        from += CHART_PAGE_SIZE * step
      ) {
        if (signal.aborted || this.disposed) return 0;
        const to = Math.min(missing.to, from + CHART_PAGE_SIZE * step);
        const [candles, signals] = await Promise.all([
          this.loaders.candles(
            this.symbol,
            this.timeframe,
            new Date(from).toISOString(),
            new Date(to).toISOString(),
            signal,
          ),
          this.loadSignals({ from, to }, signal),
        ]);
        // Abort alone is insufficient: a response may already have completed when filters/unmount change.
        if (signal.aborted || this.disposed) return 0;
        this.update({
          candles: mergeCandles(
            this.state.candles,
            candles.filter(
              (c) =>
                c.symbol === this.symbol &&
                c.tf === this.timeframe &&
                c.openTime >= from &&
                c.openTime < to,
            ),
          ),
          signals: mergeSignals(this.state.signals, signals),
          coverage: mergeCoverage(this.state.coverage, { from, to }),
        });
      }
    }
    return this.state.candles.length - previousCount;
  }

  private async loadSignals(
    range: TimeRange,
    signal: AbortSignal,
  ): Promise<LiveSignalRecord[]> {
    const records = await this.loaders.signals(
      this.symbol,
      this.timeframe,
      new Date(range.from).toISOString(),
      new Date(range.to).toISOString(),
      signal,
    );
    // The existing API caps history at 500. A saturated page is not full coverage.
    // Split only that range, sequentially, without changing the API contract.
    if (records.length < 500 || signal.aborted) return records;
    if (range.to - range.from <= 1)
      throw new Error(
        'Too many live signals at one timestamp to display the complete range.',
      );
    const middle = Math.floor((range.from + range.to) / 2);
    const left = await this.loadSignals(
      { from: range.from, to: middle },
      signal,
    );
    if (signal.aborted) return [];
    const right = await this.loadSignals(
      { from: middle, to: range.to },
      signal,
    );
    return mergeSignals(left, right);
  }
}
