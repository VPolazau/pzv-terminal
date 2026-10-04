import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './api/market.api';
import type { LiveSignalRecord } from './api/signals.api';

type Props = {
  candles: Candle[];
  signals: LiveSignalRecord[];
  timeframe: string;
};
const steps: Record<string, number> = {
  '1m': 60000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

export default function MarketChart({ candles, signals, timeframe }: Props) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      height: 420,
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
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const data: CandlestickData<UTCTimestamp>[] = sorted.map((candle) => ({
      time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    series.setData(data);
    const step = steps[timeframe] ?? 3600000;
    const candleTimes = new Set(sorted.map((candle) => candle.openTime));
    const markers = signals
      .map((signal) => Math.floor(signal.signalTime / step) * step)
      .filter(
        (time, index, all) =>
          candleTimes.has(time) && all.indexOf(time) === index,
      )
      .map((time) => {
        const signal = signals.find(
          (item) => Math.floor(item.signalTime / step) * step === time,
        );
        return {
          time: Math.floor(time / 1000) as UTCTimestamp,
          position: signal?.action === 'BUY' ? 'belowBar' : 'aboveBar',
          color: signal?.action === 'BUY' ? '#198754' : '#c43d54',
          shape: signal?.action === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: signal?.action,
        } as const;
      });
    createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();
    const resize = () =>
      container.current &&
      chart.applyOptions({ width: container.current.clientWidth });
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, signals, timeframe]);
  return (
    <div
      ref={container}
      className="market-chart"
      aria-label="Historical market candlestick chart"
    />
  );
}
