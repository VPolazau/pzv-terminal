import type { Candle, Timeframe } from '@pzv-terminal/shared-types';

export function timeframeMs(tf: Timeframe): number {
  return {
    '1m': 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
  }[tf];
}

export const BINANCE_KLINES_PAGE_LIMIT = 1000;
export const BINANCE_REQUEST_TIMEOUT_MS = 15_000;

export class BinanceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number,
  ) {
    super(`Binance request failed: ${status}`);
  }
}

async function request(path: string, baseUrl?: string): Promise<unknown> {
  const base = (
    baseUrl ??
    process.env['BINANCE_BASE_URL'] ??
    'https://api.binance.com'
  ).replace(/\/$/, '');
  const timeoutMs = Number(process.env['BINANCE_REQUEST_TIMEOUT_MS']);
  const requestTimeout =
    Number.isFinite(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000
      ? timeoutMs
      : BINANCE_REQUEST_TIMEOUT_MS;
  // Create a fresh signal for every request. Never reuse one across symbols/pages.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeout);
  try {
    const res = await fetch(`${base}/api/v3/${path}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new BinanceHttpError(
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : res.status === 418
            ? 120_000
            : res.status === 429
              ? 5_000
              : 0,
      );
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(value: unknown): number {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !value.trim())
  ) {
    throw new Error('Invalid Binance numeric value');
  }
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new Error('Invalid Binance numeric value');
  return number;
}

export async function fetchBinanceTime(): Promise<number> {
  const data = (await request('time')) as { serverTime?: unknown };
  const time = toNumber(data?.serverTime);
  if (!Number.isSafeInteger(time) || time <= 0)
    throw new Error('Invalid Binance server time');
  return time;
}

export async function fetchBinancePrice(
  symbol: string,
): Promise<{ price: number; observedAt: number }> {
  const data = (await request(
    `ticker/price?symbol=${encodeURIComponent(symbol)}`,
  )) as { symbol?: unknown; price?: unknown };
  const price = toNumber(data?.price);
  if (data?.symbol !== symbol || price <= 0)
    throw new Error('Invalid Binance ticker');
  return { price, observedAt: Date.now() };
}

export async function fetchBinanceKlines(params: {
  baseUrl?: string;
  symbol: string;
  tf: Timeframe;
  limit: number;
  startTime?: number;
  endTime?: number;
}): Promise<Candle[]> {
  const { symbol, tf, limit, startTime, endTime } = params;
  const query = new URLSearchParams({
    symbol,
    interval: tf,
    limit: String(limit),
  });
  if (startTime !== undefined) query.set('startTime', String(startTime));
  if (endTime !== undefined) query.set('endTime', String(endTime));
  const data = await request(`klines?${query}`, params.baseUrl);
  if (!Array.isArray(data)) throw new Error('Invalid Binance klines response');
  return data.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 7)
      throw new Error('Invalid Binance kline');
    const candle: Candle = {
      symbol,
      tf,
      openTime: toNumber(row[0]),
      closeTime: toNumber(row[6]),
      open: toNumber(row[1]),
      high: toNumber(row[2]),
      low: toNumber(row[3]),
      close: toNumber(row[4]),
      volume: toNumber(row[5]),
      source: 'binance',
    };
    if (
      !Number.isSafeInteger(candle.openTime) ||
      candle.openTime < 0 ||
      candle.openTime % timeframeMs(tf) !== 0 ||
      candle.closeTime !== candle.openTime + timeframeMs(tf) - 1 ||
      Math.min(candle.open, candle.high, candle.low, candle.close) <= 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.volume < 0
    ) {
      throw new Error('Invalid Binance candle values');
    }
    return candle;
  });
}

export async function fetchBinanceHistoricalKlines(params: {
  baseUrl?: string;
  symbol: string;
  tf: Timeframe;
  from: number;
  to: number;
}): Promise<Candle[]> {
  const { symbol, tf, from, to, baseUrl } = params;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from
  ) {
    throw new Error('Invalid Binance history range');
  }

  const step = timeframeMs(tf);
  const now = Date.now();
  const byOpenTime = new Map<number, Candle>();
  let cursor = from;

  while (cursor < to) {
    const page = await fetchBinanceKlines({
      baseUrl,
      symbol,
      tf,
      limit: BINANCE_KLINES_PAGE_LIMIT,
      startTime: cursor,
      endTime: to - 1,
    });
    if (page.length === 0) break;

    let lastOpenTime = cursor;
    for (const candle of page) {
      if (
        candle.openTime < from ||
        candle.openTime >= to ||
        candle.closeTime >= now
      )
        continue;
      byOpenTime.set(candle.openTime, candle);
      lastOpenTime = Math.max(lastOpenTime, candle.openTime);
    }

    const nextCursor = lastOpenTime + step;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
    if (page.length < BINANCE_KLINES_PAGE_LIMIT) break;
  }

  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}
