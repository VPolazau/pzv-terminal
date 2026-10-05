import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBacktest, useLatestSignal, useSignalHistory } from './hooks';
import type { BacktestError } from './api/backtest.api';
import type { SignalEvent } from './signal-events';
import { selectLatestEvent } from './latest-event';

import ChartSection from './ChartSection';

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
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [selectedSignal, setSelectedSignal] = useState<SignalEvent | null>(
    null,
  );
  const [feePercent, setFeePercent] = useState('0.10');
  const [capital, setCapital] = useState('100');
  const initialBalance = Number(capital);
  const validCapital =
    Number.isFinite(initialBalance) &&
    initialBalance > 0 &&
    initialBalance <= 100_000_000;
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
    initialBalance: validCapital ? initialBalance : null,
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
  const latestSignal = useMemo(
    () => selectLatestEvent(historyRows),
    [historyRows],
  );
  // Resolve current economics without refocusing when a backtest result refreshes.
  const chartSelection = selectedSignal
    ? (historyRows.find(
        (event) =>
          event.id === selectedSignal.id &&
          event.timestamp === selectedSignal.timestamp &&
          event.symbol === symbol &&
          event.timeframe === timeframe,
      ) ?? null)
    : null;
  const selectSignal = (event: SignalEvent) => {
    setSelectedSignal(event);
    setSelectionRequest((value) => value + 1);
    setChartOpen(true);
  };
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
        <Field label="Initial capital ($)">
          <input
            type="number"
            min="0"
            max="100000000"
            step="0.01"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
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
                      chartSelection?.id === x.id ? 'selected-row' : undefined
                    }
                    onClick={() => {
                      selectSignal(x);
                    }}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectSignal(x);
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
        selectedSignal={chartSelection}
        selectionRequest={selectionRequest}
      />
    </main>
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
            {metric('Initial capital', money(data.metrics.initialBalance))}
            {metric('Final equity', money(data.metrics.finalEquity))}
            {metric('Trades', data.metrics.totalTrades)}
            {metric('Win rate', percent(data.metrics.winRate))}
            {metric('Return', percent(data.metrics.returnPct))}
            {metric('Net profit', money(data.metrics.netProfit))}
            {metric('Profit factor', number(data.metrics.profitFactor))}
            {metric('Max drawdown', percent(data.metrics.maxDrawdownPct))}
            {metric('Fees', money(data.metrics.totalFees))}
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
const formatPrice = (v: number | null) =>
  v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const number = (v: number | null) => (v == null ? '—' : v.toFixed(2));
const money = (v: number | null) =>
  v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
const percent = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const Loading = () => <div className="state">Loading…</div>;
const Empty = ({ message }: { message: string }) => (
  <div className="state muted">{message}</div>
);
const ErrorState = ({ message }: { message: string }) => (
  <div className="state error">{message}</div>
);
