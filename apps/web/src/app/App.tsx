import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useBacktest, useLatestSignal, useSignalHistory } from './hooks';
import type { BacktestError } from './api/backtest.api';
import { getHistoricalCandles, type Candle } from './api/market.api';
import {
  getSignalHistoryRange,
  type LiveSignalRecord,
} from './api/signals.api';

const MarketChart = lazy(() => import('./MarketChart'));

const symbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'TAOUSDT'];
const timeframes = ['4h', '1d'];
const day = 86400000;
const dateText = (value: Date) => value.toISOString().slice(0, 10);

export default function App() {
  const now = new Date();
  const [symbol, setSymbol] = useState(symbols[0]);
  const [timeframe, setTimeframe] = useState(timeframes[0]);
  const [from, setFrom] = useState(
    dateText(new Date(now.getTime() - 30 * day)),
  );
  const [to, setTo] = useState(dateText(now));
  const [chartOpen, setChartOpen] = useState(false);
  const latest = useLatestSignal(symbol, timeframe);
  const history = useSignalHistory(symbol, timeframe);
  const backtest = useBacktest({
    symbol,
    timeframe,
    from: `${from}T00:00:00.000Z`,
    to: `${to}T00:00:00.000Z`,
  });
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
      </section>
      <section className="grid two">
        <LatestCard {...latest} symbol={symbol} timeframe={timeframe} />
        <BacktestCard {...backtest} from={from} to={to} />
      </section>
      <section className="card">
        <Heading
          eyebrow="Live data"
          title="Signal history"
          extra="Last 100 signals"
        />
        {history.loading ? (
          <Loading />
        ) : history.error ? (
          <ErrorState message={history.error.message} />
        ) : !history.data?.length ? (
          <Empty message="No live signals for this filter yet." />
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
                </tr>
              </thead>
              <tbody>
                {history.data.map((x) => (
                  <tr key={x.id}>
                    <td>{formatDate(x.signalTime)}</td>
                    <td>{x.symbol}</td>
                    <td>{x.tf}</td>
                    <td>
                      <span className={`pill ${x.action.toLowerCase()}`}>
                        {x.action}
                      </span>
                    </td>
                    <td>{formatPrice(x.price)}</td>
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
}: {
  open: boolean;
  onToggle: () => void;
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
}) {
  const [state, setState] = useState<{
    candles: Candle[];
    signals: LiveSignalRecord[];
    loading: boolean;
    error: Error | null;
  }>({ candles: [], signals: [], loading: false, error: null });
  useEffect(() => {
    if (!open) return;
    let active = true;
    setState({ candles: [], signals: [], loading: true, error: null });
    const rangeFrom = `${from}T00:00:00.000Z`;
    const rangeTo = `${to}T00:00:00.000Z`;
    Promise.all([
      getHistoricalCandles(symbol, timeframe, rangeFrom, rangeTo),
      getSignalHistoryRange(symbol, timeframe, rangeFrom, rangeTo),
    ])
      .then(
        ([candles, signals]) =>
          active && setState({ candles, signals, loading: false, error: null }),
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
          }),
      );
    return () => {
      active = false;
    };
  }, [open, symbol, timeframe, from, to]);
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
        ) : state.error ? (
          <div className="chart-placeholder error">{state.error.message}</div>
        ) : !state.candles.length ? (
          <div className="chart-placeholder">No candles for this period.</div>
        ) : (
          <Suspense
            fallback={<div className="chart-placeholder">Loading chart…</div>}
          >
            <MarketChart
              candles={state.candles}
              signals={state.signals}
              timeframe={timeframe}
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
}: ReturnType<typeof useLatestSignal> & { symbol: string; timeframe: string }) {
  return (
    <section className="card">
      <Heading eyebrow="Current state" title="Latest signal" />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : !data ? (
        <Empty message="No signal received for this market yet." />
      ) : (
        <div className="signal-detail">
          <span className={`signal-badge ${data.action.toLowerCase()}`}>
            {data.action}
          </span>
          <strong>
            {symbol} · {timeframe}
          </strong>
          <span>{formatPrice(data.price)}</span>
          <span className="muted">{formatDate(data.signalTime)}</span>
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
