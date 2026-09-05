import { randomUUID } from 'node:crypto';
import type {
  Candle,
  LiveSignalEvent,
  LiveSmaState,
  Timeframe,
} from '@pzv-terminal/shared-types';
import type { RedisClientType } from 'redis';
import { getJson } from '@pzv-terminal/core-redis';
import { liveSmaTransition, timeframeMs } from '@pzv-terminal/shared-utils';
import {
  notificationRecipients,
  pendingNotification,
  pendingNotificationsKey,
} from './notification-delivery';

export function liveStateKey(symbol: string, tf: Timeframe): string {
  return `signals:live_state:sma_cross:binance:${symbol}:${tf}:10:50`;
}

export async function processLiveObservation(params: {
  redis: RedisClientType;
  symbol: string;
  tf: Timeframe;
  candles: Candle[];
  price: number;
  observedAt: number;
  candleOpenTime: number;
}): Promise<LiveSignalEvent | null> {
  const { redis, symbol, tf, candles, price, observedAt, candleOpenTime } =
    params;
  const key = liveStateKey(symbol, tf);
  const previous = await getJson<LiveSmaState>(redis, key);
  const result = liveSmaTransition({
    closedCloses: candles.map((c) => c.close),
    price,
    fast: 10,
    slow: 50,
    observedAt,
    previous,
  });
  if (!result) return null;
  const transaction = redis.multi().set(key, JSON.stringify(result.state));
  let event: LiveSignalEvent | null = null;
  if (result.signal !== 'none' && previous) {
    event = {
      id: randomUUID(),
      type: 'sma_cross',
      mode: 'live',
      source: 'binance',
      symbol,
      tf,
      fast: 10,
      slow: 50,
      signal: result.signal,
      price,
      ts: observedAt,
      observedAt,
      detectedAt: Date.now(),
      candleOpenTime,
      candleCloseTime: candleOpenTime + timeframeMs(tf) - 1,
      now: result.state.now,
      prev: previous.now,
    };
    const recipients = await notificationRecipients(redis, symbol, tf);
    transaction.set(
      `signals:last:sma_cross:${symbol}:${tf}`,
      JSON.stringify(event),
    );
    if (recipients.length)
      transaction.hSet(
        pendingNotificationsKey,
        event.id,
        JSON.stringify(pendingNotification(event.id, event, recipients)),
      );
  }
  // No advanced state without its pending notification (and vice versa).
  await transaction.exec();
  return event;
}
