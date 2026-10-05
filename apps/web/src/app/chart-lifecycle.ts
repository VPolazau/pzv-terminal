import type {
  ISeriesApi,
  ISeriesMarkersPluginApi,
  ITimeScaleApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './api/market.api';
import type { SignalEvent } from './signal-events';
import {
  olderBoundary,
  preservedLogicalRange,
  sameLogicalRange,
  selectionLogicalRange,
  toChartCandles,
  type LogicalRange,
} from './chart-data';

type TimeScale = Pick<
  ITimeScaleApi<Time>,
  'getVisibleLogicalRange' | 'setVisibleLogicalRange' | 'fitContent' | 'width'
>;
type Frames = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

/** Imperative state belongs to one chart instance, not to a React render or a request. */
export class ChartLifecycle {
  private candles: Candle[] = [];
  private controlled = false;
  private releaseFrame: number | null = null;
  private disposed = false;
  private userRevision = 0;
  private consumedRevision = 0;
  private loadingOlder = false;
  private focusedRequest: number | null = null;
  private focus: {
    event: SignalEvent;
    request: number;
    ready: boolean;
  } | null = null;

  constructor(
    private series: Pick<ISeriesApi<'Candlestick', UTCTimestamp>, 'setData'>,
    private timeScale: TimeScale,
    private markerApi: Pick<
      ISeriesMarkersPluginApi<UTCTimestamp>,
      'setMarkers'
    >,
    private timeframe: string,
    private loadOlder: (anchor: number) => Promise<number>,
    private frames: Frames = {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    },
  ) {}

  setCandles(candles: Candle[]) {
    if (
      this.disposed ||
      this.candles === candles ||
      (!this.candles.length && !candles.length)
    )
      return;
    this.beginControlledUpdate();
    const previous = this.candles;
    // Snapshot at COMMIT, so panning while HTTP is pending is not undone.
    const desired = preservedLogicalRange(
      previous,
      candles,
      this.timeScale.getVisibleLogicalRange(),
    );
    this.series.setData(toChartCandles(candles));
    this.candles = candles;
    if (!previous.length && candles.length) {
      this.timeScale.fitContent();
    } else if (
      desired &&
      !sameLogicalRange(desired, this.timeScale.getVisibleLogicalRange())
    ) {
      // 5.2.1 preserves rightOffset/barSpacing on pure prepend already. Do NOT restore twice.
      // Only a non-prepend merge (e.g. a targeted island/gap) can need compensation.
      this.timeScale.setVisibleLogicalRange(desired);
    }
    this.releaseAfterChartFrame();
  }

  setMarkers(markers: SeriesMarker<UTCTimestamp>[]) {
    if (!this.disposed) this.markerApi.setMarkers(markers);
  }

  select(event: SignalEvent | null, request: number, ready: boolean) {
    this.focus = event ? { event, request, ready } : null;
    this.focusIfReady();
  }

  focusIfReady() {
    if (
      this.disposed ||
      !this.focus ||
      !this.focus.ready ||
      this.focus.request === this.focusedRequest ||
      this.timeScale.width() <= 0
    )
      return;
    const range = selectionLogicalRange(
      this.focus.event,
      this.candles,
      this.timeframe,
    );
    if (!range) return;
    this.beginControlledUpdate();
    this.timeScale.setVisibleLogicalRange(range);
    this.focusedRequest = this.focus.request;
    this.releaseAfterChartFrame();
  }

  userMoved() {
    if (!this.disposed) this.userRevision++;
  }

  visibleRangeChanged(range: LogicalRange | null) {
    const userMoved = this.userRevision > this.consumedRevision;
    this.consumedRevision = this.userRevision;
    if (
      this.disposed ||
      this.controlled ||
      this.loadingOlder ||
      !userMoved ||
      !range
    )
      return;
    const anchor = olderBoundary(this.candles, range.from, this.timeframe);
    if (anchor === null) return;
    this.loadingOlder = true;
    const finish = () => {
      this.loadingOlder = false;
      this.consumedRevision = this.userRevision;
    };
    // The data session publishes request errors; this listener does not own networking state.
    void this.loadOlder(anchor).then(finish, finish);
  }

  dispose() {
    this.disposed = true;
    if (this.releaseFrame !== null) this.frames.cancel(this.releaseFrame);
    this.releaseFrame = null;
    this.focus = null;
  }

  private beginControlledUpdate() {
    this.controlled = true;
    this.consumedRevision = this.userRevision;
    if (this.releaseFrame !== null) this.frames.cancel(this.releaseFrame);
    this.releaseFrame = null;
  }

  private releaseAfterChartFrame() {
    // LWC queued its draw before this callback. No delayed viewport/marker mutations here.
    this.releaseFrame = this.frames.request(() => {
      this.releaseFrame = null;
      this.controlled = false;
      this.consumedRevision = this.userRevision;
    });
  }
}
