import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { Candle } from './api/market.api';
import type { LiveSignalRecord } from './api/signals.api';
import type { SignalEvent } from './signal-events';
import { buildMarkers } from './chart-data';
import { ChartLifecycle } from './chart-lifecycle';
import { TradeRectanglePrimitive } from './trade-rectangle';

type Props = {
  candles: Candle[];
  signals: LiveSignalRecord[];
  timeframe: string;
  onLoadOlder: (oldest: number) => Promise<number>;
  events: SignalEvent[];
  selectedSignal: SignalEvent | null;
  selectionRequest?: number;
  selectionReady?: boolean;
};

export default function MarketChart({
  candles,
  signals,
  timeframe,
  onLoadOlder,
  events,
  selectedSignal,
  selectionRequest = 0,
  selectionReady = true,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<ChartLifecycle | null>(null);
  const primitive = useRef<TradeRectanglePrimitive | null>(null);
  const loadOlder = useRef(onLoadOlder);
  useLayoutEffect(() => {
    loadOlder.current = onLoadOlder;
  }, [onLoadOlder]);

  // The parent keys the session by market/period. Normal state changes never recreate the chart.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight || 420,
      layout: { background: { color: '#ffffff' }, textColor: '#60708b' },
      grid: {
        vertLines: { color: '#edf0f5' },
        horzLines: { color: '#edf0f5' },
      },
      rightPriceScale: {
        borderColor: '#d6deea',
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#d6deea',
        timeVisible: true,
        shiftVisibleRangeOnNewBar: false,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#2da66f',
      downColor: '#d85a6e',
      borderVisible: false,
      wickUpColor: '#2da66f',
      wickDownColor: '#d85a6e',
    });
    const markers = createSeriesMarkers(series, [], {
      autoScale: false,
      zOrder: 'top',
    });
    const rectangle = new TradeRectanglePrimitive();
    series.attachPrimitive(rectangle);
    const lifecycle = new ChartLifecycle(
      series,
      chart.timeScale(),
      markers,
      timeframe,
      (anchor) => loadOlder.current(anchor),
    );
    runtime.current = lifecycle;
    primitive.current = rectangle;
    const onRange = (range: { from: number; to: number } | null) =>
      lifecycle.visibleRangeChanged(range);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onScaleSize = () => lifecycle.focusIfReady();
    chart.timeScale().subscribeSizeChange(onScaleSize);
    const onWheel = () => lifecycle.userMoved();
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons || event.pointerType === 'touch') lifecycle.userMoved();
    };
    element.addEventListener('wheel', onWheel, {
      capture: true,
      passive: true,
    });
    element.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: true,
    });
    const observer = new ResizeObserver(() => {
      if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
      chart.applyOptions({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    });
    observer.observe(element);
    return () => {
      lifecycle.dispose();
      observer.disconnect();
      element.removeEventListener('wheel', onWheel, true);
      element.removeEventListener('pointermove', onPointerMove, true);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.timeScale().unsubscribeSizeChange(onScaleSize);
      markers.detach();
      series.detachPrimitive(rectangle);
      chart.remove();
      runtime.current = null;
      primitive.current = null;
    };
  }, [timeframe]);

  // Ordered layout effects: setData is synchronous, markers/focus see the installed dataset.
  useLayoutEffect(() => {
    runtime.current?.setCandles(candles);
  }, [candles]);
  const markers = useMemo(
    () => buildMarkers(candles, events, signals, timeframe),
    [candles, events, signals, timeframe],
  );
  useLayoutEffect(() => {
    runtime.current?.setMarkers(markers);
  }, [markers]);
  useLayoutEffect(() => {
    primitive.current?.setTrade(selectedSignal, timeframe);
  }, [selectedSignal, timeframe]);
  useLayoutEffect(() => {
    runtime.current?.select(selectedSignal, selectionRequest, selectionReady);
  }, [selectedSignal, selectionRequest, selectionReady, candles]);

  return (
    <div
      ref={container}
      className="market-chart"
      aria-label="Historical market candlestick chart"
    />
  );
}
