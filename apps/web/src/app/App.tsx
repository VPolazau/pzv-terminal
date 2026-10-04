import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useBacktest, useLatestSignal, useSignalHistory } from './hooks';
import type { BacktestError } from './api/backtest.api';
import { getHistoricalCandles, type Candle } from './api/market.api';
import {
  getSignalHistoryRange,
  type LiveSignalRecord,
} from './api/signals.api';
import type { SignalEvent } from './signal-events';

const MarketChart = lazy(() => import('./MarketChart'));

const symbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'TAOUSDT'];
const timeframes = ['4h', '1d'];
const day = 86400000;
const dateText = (value: Date) => value.toISOString().slice(0, 10);
const steps: Record<string, number> = {
  '1m': 60000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

export default function App() {
  const now = new Date();
  const [symbol, setSymbol] = useState(symbols[0]);
  const [timeframe, setTimeframe] = useState(timeframes[0]);
  const [from, setFrom] = useState(
    dateText(new Date(now.getTime() - 30 * day)),
  );
  const [to, setTo] = useState(dateText(now));
  const [chartOpen, setChartOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<SignalEvent | null>(
    null,
  );
  const [feePercent, setFeePercent] = useState('0.10');
  const feeRate = Number(feePercent) / 100;
  const latest = useLatestSignal(symbol, timeframe);
  const history = useSignalHistory(symbol, timeframe);
  const backtest = useBacktest({
    symbol,
    timeframe,
    from: `${from}T00:00:00.000Z`,
    to: `${to}T00:00:00.000Z`,
    feeRate:
      Number.isFinite(feeRate) && feeRate >= 0 && feeRate <= 10
        ? feeRate
        : 0.001,
  });
  const historyRows = useMemo<SignalEvent[]>(() => {
    const live = (history.data ?? []).map((x) => ({
      id: `LIVE:${x.id}`,
      time: x.signalTime,
      timestamp: x.signalTime,
      timeframe: x.tf,
      symbol: x.symbol,
      tf: x.tf,
      action: x.action,
      price: x.price,
      fee: null,
      profit: null,
      source: 'LIVE' as const,
    }));
    const historical = (backtest.data?.trades ?? []).flatMap((trade) => [
      {
        id: `HIST:${trade.sequence}:BUY`,
        time: trade.entryTime,
        timestamp: trade.entryTime,
        timeframe: trade.timeframe,
        symbol: trade.symbol,
        tf: trade.timeframe,
        action: 'BUY' as const,
        price: trade.entryPrice,
        fee: trade.entryFee,
        profit: null,
        source: 'HISTORICAL' as const,
        tradeId: `HIST:${trade.sequence}`,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        netPnl: trade.netPnl,
      },
      {
        id: `HIST:${trade.sequence}:SELL`,
        time: trade.exitTime,
        timestamp: trade.exitTime,
        timeframe: trade.timeframe,
        symbol: trade.symbol,
        tf: trade.timeframe,
        action: 'SELL' as const,
        price: trade.exitPrice,
        fee: trade.exitFee,
        profit: trade.netPnl,
        source: 'HISTORICAL' as const,
        tradeId: `HIST:${trade.sequence}`,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        netPnl: trade.netPnl,
      },
    ]);
    const seen = new Set<string>();
    return [...historical, ...live]
      .sort((a, b) => b.time - a.time)
      .filter((row) => {
        const key = `${row.symbol}|${row.timeframe}|${row.action}|${row.time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [backtest.data, history.data]);
  const latestSignal = useMemo(() => {
    const live = history.data?.[0];
    const historical = historyRows
      .filter((x) => x.source === 'HISTORICAL')
      .at(-1);
    if (live && (!historical || live.signalTime >= historical.time))
      return { ...live, source: 'LIVE' as const, time: live.signalTime };
    return historical ?? null;
  }, [history.data, historyRows]);
  return (
    <main className="shell">
      <header className="header">
        <div>
          <span className="eyebrow">PZV TERMINAL · v1.0.0</span>
          <h1>Market dashboard</h1>
        </div>
        <span className="status-dot">Live monitoring</span>
      </header>
      <section className="card filters">
        <Field label="Symbol">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Timeframe">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
          >
            {timeframes.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Trading fee (%)">
          <input
            type="number"
            min="0"
            max="10"
            step="0.01"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
          />
        </Field>
      </section>
      <section className="grid two">
        <LatestCard
          data={latestSignal}
          loading={latest.loading}
          error={latest.error}
          symbol={symbol}
          timeframe={timeframe}
        />
        <BacktestCard {...backtest} from={from} to={to} />
      </section>
      <section className="card history-panel">
        <Heading
          eyebrow="Live data"
          title="Signal history"
          extra="Live + historical"
        />
        {history.loading ? (
          <Loading />
        ) : history.error ? (
          <ErrorState message={history.error.message} />
        ) : !historyRows.length ? (
          <Empty message="No signals for this filter yet." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Symbol</th>
                  <th>Timeframe</th>
                  <th>Action</th>
                  <th>Price</th>
                  <th>Fee</th>
                  <th>Profit</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((x) => (
                  <tr
                    key={x.id}
                    className={
                      selectedSignal?.id === x.id ? 'selected-row' : undefined
                    }
                    onClick={() => {
                      setSelectedSignal(x);
                      setChartOpen(true);
                    }}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedSignal(x);
                        setChartOpen(true);
                      }
                    }}
                  >
                    <td>{formatDate(x.time)}</td>
                    <td>{x.symbol}</td>
                    <td>{x.timeframe}</td>
                    <td>
                      <span className={`pill ${x.action.toLowerCase()}`}>
                        {x.action}
                      </span>
                    </td>
                    <td>{formatPrice(x.price)}</td>
                    <td>{formatPrice(x.fee)}</td>
                    <td>{x.profit == null ? '—' : formatPrice(x.profit)}</td>
                    <td>
                      <span className="pill source">{x.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ChartSection
        open={chartOpen}
        onToggle={() => setChartOpen((x) => !x)}
        symbol={symbol}
        timeframe={timeframe}
        from={from}
        to={to}
        events={historyRows}
        selectedSignal={selectedSignal}
      />
    </main>
  );
}

function ChartSection({
  open,
  onToggle,
  symbol,
  timeframe,
  from,
  to,
  events,
  selectedSignal,
}: {
  open: boolean;
  onToggle: () => void;
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  events: SignalEvent[];
  selectedSignal: SignalEvent | null;
}) {
  const [state, setState] = useState<{
    candles: Candle[];
    signals: LiveSignalRecord[];
    loading: boolean;
    error: Error | null;
    hasMoreOlder: boolean;
    loadingOlder: boolean;
  }>({
    candles: [],
    signals: [],
    loading: false,
    error: null,
    hasMoreOlder: false,
    loadingOlder: false,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState({
      candles: [],
      signals: [],
      loading: true,
      error: null,
      hasMoreOlder: true,
      loadingOlder: false,
    });
    const step: Record<string, number> = {
      '1m': 60000,
      '1h': 3600000,
      '4h': 14400000,
      '1d': 86400000,
    };
    const periodFrom = Date.parse(`${from}T00:00:00.000Z`);
    const periodTo = Date.parse(`${to}T00:00:00.000Z`);
    const initialFrom = Math.max(
      periodFrom,
      periodTo - (step[timeframe] ?? 3600000) * 800,
    );
    const rangeFrom = new Date(initialFrom).toISOString();
    const rangeTo = `${to}T00:00:00.000Z`;
    Promise.all([
      getHistoricalCandles(symbol, timeframe, rangeFrom, rangeTo),
      getSignalHistoryRange(symbol, timeframe, rangeFrom, rangeTo),
    ])
      .then(
        ([candles, signals]) =>
          active &&
          setState({
            candles,
            signals,
            loading: false,
            error: null,
            hasMoreOlder: initialFrom > periodFrom,
            loadingOlder: false,
          }),
      )
      .catch(
        (error) =>
          active &&
          setState({
            candles: [],
            signals: [],
            loading: false,
            error:
              error instanceof Error
                ? error
                : new Error('Chart data request failed'),
            hasMoreOlder: false,
            loadingOlder: false,
          }),
      );
    return () => {
      active = false;
    };
  }, [open, symbol, timeframe, from, to]);
  useEffect(() => {
    if (
      !open ||
      !selectedSignal ||
      selectedSignal.symbol !== symbol ||
      selectedSignal.timeframe !== timeframe ||
      state.candles.some(
        (c) =>
          c.openTime ===
          Math.floor(selectedSignal.timestamp / (steps[timeframe] ?? 3600000)) *
            (steps[timeframe] ?? 3600000),
      )
    )
      return;
    const step = steps[timeframe] ?? 3600000;
    const center = Math.floor(selectedSignal.timestamp / step) * step;
    const rangeFrom = new Date(center - step * 150).toISOString();
    const rangeTo = new Date(center + step * 150).toISOString();
    Promise.all([
      getHistoricalCandles(symbol, timeframe, rangeFrom, rangeTo),
      getSignalHistoryRange(symbol, timeframe, rangeFrom, rangeTo),
    ])
      .then(([candles, signals]) =>
        setState((s) => ({
          ...s,
          candles: [
            ...new Map(
              [...s.candles, ...candles].map((c) => [c.openTime, c]),
            ).values(),
          ].sort((a, b) => a.openTime - b.openTime),
          signals: [
            ...new Map(
              [...s.signals, ...signals].map((x) => [x.id, x]),
            ).values(),
          ].sort((a, b) => a.signalTime - b.signalTime),
        })),
      )
      .catch(() =>
        setState((s) => ({
          ...s,
          error: new Error('Unable to load selected signal candle'),
        })),
      );
  }, [open, selectedSignal, symbol, timeframe, state.candles]);
  const loadOlder = useCallback(
    async (oldest: number) => {
      const current = stateRef.current;
      if (!current.hasMoreOlder || current.loadingOlder) return 0;
      const step: Record<string, number> = {
        '1m': 60000,
        '1h': 3600000,
        '4h': 14400000,
        '1d': 86400000,
      };
      const size = (step[timeframe] ?? 3600000) * 800;
      const periodFrom = Date.parse(`${from}T00:00:00.000Z`);
      const olderFrom = Math.max(periodFrom, oldest - size);
      if (olderFrom >= oldest) {
        setState((s) => ({ ...s, hasMoreOlder: false }));
        return 0;
      }
      setState((s) => ({ ...s, loadingOlder: true }));
      try {
        const [olderCandles, olderSignals] = await Promise.all([
          getHistoricalCandles(
            symbol,
            timeframe,
            new Date(olderFrom).toISOString(),
            new Date(oldest).toISOString(),
          ),
          getSignalHistoryRange(
            symbol,
            timeframe,
            new Date(olderFrom).toISOString(),
            new Date(oldest).toISOString(),
          ),
        ]);
        const candleMap = new Map(
          [...olderCandles, ...current.candles].map((c) => [c.openTime, c]),
        );
        const signalMap = new Map(
          [...olderSignals, ...current.signals].map((s) => [s.id, s]),
        );
        const merged = [...candleMap.values()].sort(
          (a, b) => a.openTime - b.openTime,
        );
        setState((s) => ({
          ...s,
          candles: merged,
          signals: [...signalMap.values()].sort(
            (a, b) => a.signalTime - b.signalTime,
          ),
          loadingOlder: false,
          hasMoreOlder: olderFrom > periodFrom,
        }));
        return olderCandles.filter(
          (c) =>
            !current.candles.some(
              (existing) => existing.openTime === c.openTime,
            ),
        ).length;
      } catch (error) {
        setState((s) => ({
          ...s,
          loadingOlder: false,
          error:
            error instanceof Error
              ? error
              : new Error('Unable to load older candles'),
        }));
        return 0;
      }
    },
    [from, symbol, timeframe],
  );
  return (
    <section className="card chart-card">
      <div>
        <span className="eyebrow">Market data</span>
        <h2>Market chart</h2>
        <p className="muted">
          Historical candles and real live signal markers.
        </p>
      </div>
      <button className="secondary" onClick={onToggle}>
        {open ? 'Close chart' : 'Open chart'}
      </button>
      {open &&
        (state.loading ? (
          <div className="chart-placeholder">Loading chart data…</div>
        ) : state.error && !state.candles.length ? (
          <div className="chart-placeholder error">{state.error.message}</div>
        ) : !state.candles.length ? (
          <div className="chart-placeholder">No candles for this period.</div>
        ) : (
          <Suspense
            fallback={<div className="chart-placeholder">Loading chart…</div>}
          >
            {state.error && (
              <div className="chart-retry error">
                Older candles failed to load. Scroll left to retry.
              </div>
            )}
            {state.loadingOlder && (
              <div className="chart-retry muted">Loading older candles…</div>
            )}
            <MarketChart
              candles={state.candles}
              signals={state.signals}
              timeframe={timeframe}
              onLoadOlder={loadOlder}
              events={events}
              selectedSignal={selectedSignal}
            />
          </Suspense>
        ))}
    </section>
  );
}

function LatestCard({
  data,
  loading,
  error,
  symbol,
  timeframe,
}: {
  data: {
    action: 'BUY' | 'SELL';
    price: number;
    signalTime?: number;
    time?: number;
    source: 'LIVE' | 'HISTORICAL';
  } | null;
  loading: boolean;
  error: Error | null;
  symbol: string;
  timeframe: string;
}) {
  return (
    <section className="card">
      <Heading eyebrow="Signal overview" title="Latest signal" />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : !data ? (
        <Empty message="No live signal yet." />
      ) : (
        <div className="signal-detail">
          <span className={`signal-badge ${data.action.toLowerCase()}`}>
            {data.action}
          </span>
          <strong>
            {symbol} · {timeframe}
          </strong>
          <span>{formatPrice(data.price)}</span>
          <span className="pill source">{data.source}</span>
          <span className="muted">
            {formatDate(data.signalTime ?? data.time ?? 0)}
          </span>
        </div>
      )}
    </section>
  );
}
function BacktestCard({
  data,
  loading,
  error,
  from,
  to,
}: ReturnType<typeof useBacktest> & { from: string; to: string }) {
  const e = error as BacktestError | null;
  return (
    <section className="card">
      <Heading eyebrow="Historical simulation" title="Backtest summary" />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState
          message={
            e?.code === 'INCOMPLETE_HISTORICAL_DATA'
              ? 'Historical data is incomplete for this period.'
              : error.message
          }
        />
      ) : !data ? (
        <Empty message="Choose a period to run the simulation." />
      ) : (
        <>
          <p className="muted period">
            {from} → {to}
          </p>
          <div className="metrics">
            {metric('Trades', data.metrics.totalTrades)}
            {metric('Win rate', percent(data.metrics.winRate))}
            {metric('Return', percent(data.metrics.returnPct))}
            {metric('Net profit', number(data.metrics.netProfit))}
            {metric('Profit factor', number(data.metrics.profitFactor))}
            {metric('Max drawdown', percent(data.metrics.maxDrawdownPct))}
            {metric('Fees', number(data.metrics.totalFees))}
          </div>
          <div className="quality">
            Data quality:{' '}
            <strong>
              {data.dataQuality.complete ? 'Complete' : 'Incomplete'}
            </strong>{' '}
            · {data.dataQuality.actualCandles}/
            {data.dataQuality.expectedCandles} candles
          </div>
        </>
      )}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function Heading({
  eyebrow,
  title,
  extra,
}: {
  eyebrow: string;
  title: string;
  extra?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {extra && <span className="muted">{extra}</span>}
    </div>
  );
}
const metric = (label: string, value: string | number) => (
  <div className="metric" key={label}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
const formatDate = (v: number) => new Date(v).toLocaleString();
const formatPrice = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const number = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const percent = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const Loading = () => <div className="state">Loading…</div>;
const Empty = ({ message }: { message: string }) => (
  <div className="state muted">{message}</div>
);
const ErrorState = ({ message }: { message: string }) => (
  <div className="state error">{message}</div>
);
