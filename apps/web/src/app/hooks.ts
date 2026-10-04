import { useEffect, useState } from 'react';
import {
  getLatestSignal,
  getSignalHistory,
  type LiveSignalRecord,
} from './api/signals.api';
import { runBacktest, type BacktestResponse } from './api/backtest.api';
function useAsync<T>(load: () => Promise<T>, deps: string[]) {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: Error | null;
  }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: null });
    load()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch(
        (e: unknown) =>
          active &&
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e : new Error('Request failed'),
          }),
      );
    return () => {
      active = false;
    };
  }, deps);
  return state;
}
export const useLatestSignal = (s: string, t: string) =>
  useAsync(() => getLatestSignal(s, t), [s, t]);
export const useSignalHistory = (s: string, t: string) =>
  useAsync<LiveSignalRecord[]>(() => getSignalHistory(s, t), [s, t]);
export const useBacktest = (i: {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
}) =>
  useAsync<BacktestResponse>(
    () => runBacktest(i),
    [i.symbol, i.timeframe, i.from, i.to],
  );
