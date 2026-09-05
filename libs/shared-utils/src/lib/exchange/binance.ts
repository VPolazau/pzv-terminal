import type { Candle, Timeframe } from '@pzv-terminal/shared-types';

export function timeframeMs(tf: Timeframe): number {
  return tf === '1m' ? 60_000 : 4 * 60 * 60_000;
}

async function request(path: string, baseUrl?: string): Promise<unknown> {
  const base = (
    baseUrl ??
    process.env['BINANCE_BASE_URL'] ??
    'https://api.binance.com'
  ).replace(/\/$/, '');
  const res = await fetch(`${base}/api/v3/${path}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok)
    throw new Error(`Binance ${path.split('?')[0]} failed: ${res.status}`);
  return res.json();
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
