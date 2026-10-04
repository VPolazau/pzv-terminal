import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './api/market.api';
import type { LiveSignalRecord } from './api/signals.api';

type Props = {
  candles: Candle[];
  signals: LiveSignalRecord[];
  timeframe: string;
  onLoadOlder: (oldest: number) => Promise<number>;
};
const steps: Record<string, number> = {
  '1m': 60000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

export default function MarketChart({
  candles,
  signals,
  timeframe,
  onLoadOlder,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markerRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const candlesRef = useRef(candles);
  const signalsRef = useRef(signals);
  const savedRangeRef =
    useRef<
      ReturnType<
        IChartApi['timeScale']
      >['getVisibleRange'] extends () => infer R
        ? R
        : never
    >(null);
  const restoringRef = useRef(false);
  candlesRef.current = candles;
  signalsRef.current = signals;

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      height: container.current.clientHeight || 420,
      layout: { background: { color: '#ffffff' }, textColor: '#60708b' },
      grid: {
        vertLines: { color: '#edf0f5' },
        horzLines: { color: '#edf0f5' },
      },
      rightPriceScale: { borderColor: '#d6deea' },
      timeScale: { borderColor: '#d6deea', timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#2da66f',
      downColor: '#d85a6e',
      borderVisible: false,
      wickUpColor: '#2da66f',
      wickDownColor: '#d85a6e',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markerRef.current = createSeriesMarkers(series);
    let loadingOlder = false;
    const onRange = async (range: { from: number; to: number } | null) => {
      if (
        !range ||
        loadingOlder ||
        restoringRef.current ||
        range.from > 3 ||
        !candlesRef.current.length
      )
        return;
      loadingOlder = true;
      savedRangeRef.current = chart.timeScale().getVisibleRange();
      try {
        const inserted = await onLoadOlder(candlesRef.current[0].openTime);
        if (inserted === 0) savedRangeRef.current = null;
      } finally {
        loadingOlder = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const resize = () =>
      container.current &&
      chart.applyOptions({
        width: container.current.clientWidth,
        height: container.current.clientHeight || 420,
      });
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerRef.current = null;
    };
  }, [onLoadOlder]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const markerApi = markerRef.current;
    if (!series || !chart || !markerApi || !candles.length) return;
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const data: CandlestickData<UTCTimestamp>[] = sorted.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);
    if (savedRangeRef.current) {
      restoringRef.current = true;
      const range = savedRangeRef.current;
      savedRangeRef.current = null;
      requestAnimationFrame(() => {
        chart.timeScale().setVisibleRange(range);
        restoringRef.current = false;
      });
    }
    const step = steps[timeframe] ?? 3600000;
    const candleTimes = new Set(sorted.map((c) => c.openTime));
    const seen = new Set<number>();
    const markers = signals
      .map((s) => Math.floor(s.signalTime / step) * step)
      .filter((t) => candleTimes.has(t) && !seen.has(t) && seen.add(t))
      .map((t) => {
        const signal = signals.find(
          (s) => Math.floor(s.signalTime / step) * step === t,
        );
        return {
          time: Math.floor(t / 1000) as UTCTimestamp,
          position: signal?.action === 'BUY' ? 'belowBar' : 'aboveBar',
          color: signal?.action === 'BUY' ? '#198754' : '#c43d54',
          shape: signal?.action === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: signal?.action,
        } as const;
      });
    markerApi.setMarkers(markers);
    if (!chartRef.current?.timeScale().getVisibleLogicalRange())
      chart.timeScale().fitContent();
  }, [candles, signals, timeframe]);
  return (
    <div
      ref={container}
      className="market-chart"
      aria-label="Historical market candlestick chart"
    />
  );
}
