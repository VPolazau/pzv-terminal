import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SignalEvent } from './signal-events';
import { ChartHistory, emptyChartHistory } from './chart-history';
import MarketChart from './MarketChart';

export default function ChartSession({
  symbol,
  timeframe,
  from,
  to,
  events,
  selectedSignal,
  selectionRequest,
}: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  events: SignalEvent[];
  selectedSignal: SignalEvent | null;
  selectionRequest: number;
}) {
  const session = useRef<ChartHistory | null>(null);
  const [state, setState] = useState(emptyChartHistory);
  const periodFrom = Date.parse(`${from}T00:00:00.000Z`);
  const periodTo = Date.parse(`${to}T00:00:00.000Z`);
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.symbol === symbol &&
          event.timeframe === timeframe &&
          (event.source === 'LIVE' ||
            (event.timestamp >= periodFrom && event.timestamp < periodTo)),
      ),
    [events, symbol, timeframe, periodFrom, periodTo],
  );
  const selection =
    selectedSignal &&
    filteredEvents.some(
      (event) =>
        event.id === selectedSignal.id &&
        event.timestamp === selectedSignal.timestamp,
    )
      ? selectedSignal
      : null;

  useEffect(() => {
    const current = new ChartHistory(
      symbol,
      timeframe,
      { from: periodFrom, to: periodTo },
      setState,
    );
    session.current = current;
    setState(emptyChartHistory());
    void current.initialize();
    return () => {
      current.dispose();
      session.current = null;
    };
  }, [symbol, timeframe, periodFrom, periodTo]);

  useEffect(() => {
    void session.current?.select(selection);
  }, [selection, selectionRequest, symbol, timeframe, periodFrom, periodTo]);
  const loadOlder = useCallback(
    (anchor: number) =>
      session.current?.loadOlder(anchor) ?? Promise.resolve(0),
    [],
  );
  const selectionReady = session.current?.selectionReady(selection) ?? false;

  return (
    <div className="chart-session">
      <div className="chart-status" role="status">
        {state.error ? (
          <span className="error">
            {state.error.message}{' '}
            {state.error.retryable && (
              <button
                className="secondary"
                onClick={() => {
                  void session.current?.retry();
                }}
              >
                Retry
              </button>
            )}
          </span>
        ) : state.loading ? (
          <span className="muted">
            {state.loading === 'older'
              ? 'Loading older candles…'
              : state.loading === 'selection'
                ? 'Loading selected trade…'
                : 'Loading chart data…'}
          </span>
        ) : null}
      </div>
      {state.candles.length ? (
        <MarketChart
          candles={state.candles}
          signals={state.signals}
          timeframe={timeframe}
          onLoadOlder={loadOlder}
          events={filteredEvents}
          selectedSignal={selection}
          selectionRequest={selectionRequest}
          selectionReady={selectionReady}
        />
      ) : !state.loading && !state.error ? (
        <div className="chart-placeholder">No candles for this period.</div>
      ) : null}
    </div>
  );
}
