import type { RedisClientType } from 'redis';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';
import { setJson, getJson } from '@pzv-terminal/core-redis';

function tfToMs(tf: Timeframe): number {
  const scale = Math.max(1, Number(process.env['MOCK_TIME_SCALE']) || 1);

  const baseMs = (() => {
    switch (tf) {
      case '1m':
        return 60_000;
      // case '5m':
      //   return 5 * 60_000;
      // case '15m':
      //   return 15 * 60_000;
      // case '45m':
      //   return 45 * 60_000;
      // case '1h':
      //   return 60 * 60_000;
      case '4h':
        return 4 * 60 * 60_000;
      case '1d':
        return 24 * 60 * 60_000;
      // case '1d':
      //   return 24 * 60 * 60_000;
    }
  })();

  return Math.max(1000, Math.floor(baseMs / scale));
}

export function currentCloseTime(tf: Timeframe, now = Date.now()): number {
  const step = tfToMs(tf);
  const alignedOpen = Math.floor(now / step) * step;
  return alignedOpen + step;
}

export function candlesKey(symbol: string, tf: Timeframe): string {
  return `market:candles:${symbol}:${tf}`;
}

export async function writeMockCandles(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  limit: number;
  ttlSeconds?: number;
}): Promise<Candle[]> {
  const { redis, symbol, tf, limit } = params;

  const step = tfToMs(tf);
  const now = Date.now();
  const alignedClose = Math.floor(now / step) * step;
  const startOpen = alignedClose - step * limit;

  let lastClose = 60_000;

  const candles: Candle[] = [];
  for (let i = 0; i < limit; i++) {
    const openTime = startOpen + i * step;
    const closeTime = openTime + step;

    const open = lastClose;
    const delta = (Math.random() - 0.5) * 1200;
    const close = Math.max(1, open + delta);

    const high = Math.max(open, close) + Math.random() * 50;
    const low = Math.min(open, close) - Math.random() * 50;
    const volume = 50 + Math.random() * 200;

    const c: Candle = {
      symbol,
      tf,
      openTime,
      closeTime,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number(volume.toFixed(3)),
      source: 'mock',
    };

    candles.push(c);
    lastClose = c.close;
  }

  await setJson(redis, candlesKey(symbol, tf), candles, params.ttlSeconds);
  return candles;
}

export async function initMockCandles(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  limit: number;
  ttlSeconds?: number;
}): Promise<Candle[]> {
  const { redis, symbol, tf, limit, ttlSeconds } = params;

  const step = tfToMs(tf);
  const close = currentCloseTime(tf) - step;
  const startOpen = close - step * limit;

  let lastClose = 60_000;
  const candles: Candle[] = [];

  for (let i = 0; i < limit; i++) {
    const openTime = startOpen + i * step;
    const closeTime = openTime + step;

    const open = lastClose;
    const delta = (Math.random() - 0.5) * 1200;
    const closeP = Math.max(1, open + delta);

    const high = Math.max(open, closeP) + Math.random() * 50;
    const low = Math.min(open, closeP) - Math.random() * 50;
    const volume = 50 + Math.random() * 200;

    const c: Candle = {
      symbol,
      tf,
      openTime,
      closeTime,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(closeP.toFixed(2)),
      volume: Number(volume.toFixed(3)),
      source: 'mock',
    };

    candles.push(c);
    lastClose = c.close;
  }

  await setJson(redis, candlesKey(symbol, tf), candles, ttlSeconds);
  return candles;
}

export async function appendMockCandle(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  limit: number;
  ttlSeconds?: number;
}): Promise<{ candles: Candle[]; appended?: Candle }> {
  const { redis, symbol, tf, limit, ttlSeconds } = params;

  const key = candlesKey(symbol, tf);
  const existing = (await getJson<Candle[]>(redis, key)) ?? [];

  // если пусто - инициализируем
  if (
    existing.length === 0 ||
    existing.some((c) => c.source !== 'mock') ||
    existing[existing.length - 1].closeTime > Date.now()
  ) {
    const init = await initMockCandles({
      redis,
      symbol,
      tf,
      limit,
      ttlSeconds,
    });
    return { candles: init };
  }

  const last = existing[existing.length - 1];
  const step = tfToMs(tf);

  if (last.closeTime + step > Date.now()) return { candles: existing };

  const openTime = last.closeTime;
  const closeTime = openTime + step;

  const open = last.close;
  const delta = (Math.random() - 0.5) * 1200;
  const closeP = Math.max(1, open + delta);

  const high = Math.max(open, closeP) + Math.random() * 50;
  const low = Math.min(open, closeP) - Math.random() * 50;
  const volume = 50 + Math.random() * 200;

  const appended: Candle = {
    symbol,
    tf,
    openTime,
    closeTime,
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(closeP.toFixed(2)),
    volume: Number(volume.toFixed(3)),
    source: 'mock',
  };

  const next = [...existing, appended].slice(-limit);
  await setJson(redis, key, next, ttlSeconds);

  return { candles: next, appended };
}
