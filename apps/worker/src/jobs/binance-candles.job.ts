import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import type { RedisClientType } from 'redis';
import { setJson } from '@pzv-terminal/core-redis';
import { fetchBinanceKlines, timeframeMs } from '@pzv-terminal/shared-utils';
import { candlesKey } from './candles.job';

export function normalizeClosedCandles(
  candles: Candle[],
  serverTime: number,
  limit: number,
): Candle[] {
  const byOpen = new Map<number, Candle>();
  for (const candle of candles) {
    if (candle.source === 'binance' && candle.closeTime < serverTime) {
      byOpen.set(candle.openTime, candle);
    }
  }
  return [...byOpen.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

export async function syncBinanceCandles(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  limit: number;
  ttlSeconds: number;
  serverTime: number;
}): Promise<Candle[]> {
  const { redis, symbol, tf, limit, ttlSeconds, serverTime } = params;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid Binance history limit');
  const step = timeframeMs(tf);
  const currentOpen = Math.floor(serverTime / step) * step;
  // The whole retained window fits in one REST request (up to 1000).
  // Authoritative replacement also repairs old live snapshots and mixed sources.
  const fetched = await fetchBinanceKlines({
    symbol,
    tf,
    limit,
    startTime: Math.max(0, currentOpen - limit * step),
    endTime: currentOpen - 1,
  });
  const candles = normalizeClosedCandles(fetched, serverTime, limit);
  if (
    candles.length !== limit ||
    candles.some(
      (c, i) =>
        c.symbol !== symbol ||
        c.tf !== tf ||
        c.openTime !== currentOpen - (limit - i) * step ||
        c.closeTime !== c.openTime + step - 1,
    )
  ) {
    // Never evaluate live SMA on a partially synchronized or stale window.
    throw new Error(`Incomplete Binance closed history: ${symbol} ${tf}`);
  }
  await setJson(redis, candlesKey(symbol, tf), candles, ttlSeconds);
  return candles;
}
