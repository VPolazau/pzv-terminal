import { lazy, Suspense } from 'react';
import type { SignalEvent } from './signal-events';

const ChartSession = lazy(() => import('./ChartSession'));

export default function ChartSection({
  open,
  onToggle,
  symbol,
  timeframe,
  from,
  to,
  events,
  selectedSignal,
  selectionRequest,
}: {
  open: boolean;
  onToggle: () => void;
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  events: SignalEvent[];
  selectedSignal: SignalEvent | null;
  selectionRequest: number;
}) {
  return (
    <section className="card chart-card">
      <div>
        <span className="eyebrow">Market data</span>
        <h2>Market chart</h2>
        <p className="muted">
          Historical candles and historical/live signal markers.
        </p>
      </div>
      <button className="secondary" onClick={onToggle} aria-expanded={open}>
        {open ? 'Close chart' : 'Open chart'}
      </button>
      {open && (
        <Suspense
          fallback={<div className="chart-placeholder">Loading chart…</div>}
        >
          <ChartSession
            key={`${symbol}:${timeframe}:${from}:${to}`}
            symbol={symbol}
            timeframe={timeframe}
            from={from}
            to={to}
            events={events}
            selectedSignal={selectedSignal}
            selectionRequest={selectionRequest}
          />
        </Suspense>
      )}
    </section>
  );
}
