import type { RedisClientType } from "redis";
import type { Candle, Timeframe } from "@pzv-terminal/shared-types";
import { setJson } from "@pzv-terminal/core-redis";

function tfToMs(tf: Timeframe): number {
  switch (tf) {
    case "1m": return 60_000;
    case "5m": return 5 * 60_000;
    case "15m": return 15 * 60_000;
    case "1h": return 60 * 60_000;
    case "4h": return 4 * 60 * 60_000;
    case "1d": return 24 * 60 * 60_000;
  }
}

export function candlesKey(symbol: string, tf: Timeframe): string {
  return `market:candles:${symbol}:${tf}`;
}

export async function writeMockCandles(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  limit: number;
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
      source: "mock",
    };

    candles.push(c);
    lastClose = c.close;
  }

  await setJson(redis, candlesKey(symbol, tf), candles);
  return candles;
}
