import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { SignalEvent } from './signal-events';
import { candleOpenTime, chartTime } from './chart-data';

export function normalizeRectangle(
  x1: number | null,
  x2: number | null,
  y1: number | null,
  y2: number | null,
) {
  if (
    [x1, x2, y1, y2].some((value) => value === null || !Number.isFinite(value))
  )
    return null;
  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

export function rectangleStyle(netPnl: number) {
  return netPnl >= 0
    ? { fill: 'rgba(38, 166, 214, 0.16)', border: 'rgba(38, 140, 190, 0.65)' }
    : { fill: 'rgba(196, 61, 84, 0.16)', border: 'rgba(170, 50, 70, 0.65)' };
}

export function rectangleTrade(event: SignalEvent | null) {
  return event?.source === 'HISTORICAL' &&
    [
      event.entryTime,
      event.exitTime,
      event.entryPrice,
      event.exitPrice,
      event.netPnl,
    ].every(Number.isFinite)
    ? event
    : null;
}

export class TradeRectanglePrimitive implements ISeriesPrimitive<Time> {
  private context: SeriesAttachedParameter<Time> | null = null;
  private trade: SignalEvent | null = null;
  private timeframe = '1h';
  private renderer: IPrimitivePaneRenderer = {
    draw: (target) => this.draw(target),
  };
  private views: IPrimitivePaneView[] = [
    { zOrder: () => 'bottom', renderer: () => this.renderer },
  ];

  attached(context: SeriesAttachedParameter<Time>) {
    this.context = context;
  }
  detached() {
    this.context = null;
    this.trade = null;
  }
  paneViews() {
    return this.views;
  }
  setTrade(event: SignalEvent | null, timeframe: string) {
    this.trade = rectangleTrade(event);
    this.timeframe = timeframe;
    this.context?.requestUpdate();
  }

  private draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    const context = this.context;
    const trade = this.trade;
    if (!context || !trade) return;
    const timeScale = context.chart.timeScale();
    const box = normalizeRectangle(
      timeScale.timeToCoordinate(
        chartTime(candleOpenTime(trade.entryTime, this.timeframe)),
      ),
      timeScale.timeToCoordinate(
        chartTime(candleOpenTime(trade.exitTime, this.timeframe)),
      ),
      context.series.priceToCoordinate(trade.entryPrice),
      context.series.priceToCoordinate(trade.exitPrice),
    );
    if (!box) return; // No layout / unloaded candle is a normal state, not an exception.
    const style = rectangleStyle(trade.netPnl);
    target.useBitmapCoordinateSpace(
      ({
        context: ctx,
        horizontalPixelRatio: xRatio,
        verticalPixelRatio: yRatio,
      }) => {
        const left = box.left * xRatio;
        const top = box.top * yRatio;
        const width = Math.max(xRatio, (box.right - box.left) * xRatio);
        const height = Math.max(yRatio, (box.bottom - box.top) * yRatio);
        ctx.save();
        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.border;
        ctx.lineWidth = xRatio;
        ctx.fillRect(left, top, width, height);
        ctx.strokeRect(left, top, width, height);
        ctx.restore();
      },
    );
  }
}
