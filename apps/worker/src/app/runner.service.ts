import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Candle,
  ClosedSignalEvent,
  Timeframe,
} from '@pzv-terminal/shared-types';
import type { RedisClientType } from 'redis';
import { createLogger } from '@pzv-terminal/core-logger';
import { closeRedis, connectRedis } from '@pzv-terminal/core-redis';
import {
  fetchBinancePrice,
  fetchBinanceTime,
  smaCrossAt,
  timeframeMs,
} from '@pzv-terminal/shared-utils';
import { appendMockCandle } from '../jobs/candles.job';
import { syncBinanceCandles } from '../jobs/binance-candles.job';
import { processLiveObservation } from './live-signal.processor';
import {
  NotificationDelivery,
  notificationRecipients,
  pendingNotification,
  pendingNotificationsKey,
} from './notification-delivery';
import { SequentialLoop } from './sequential-loop';

const symbol = 'BTCUSDT';
const tfs: Timeframe[] = ['1m', '4h'];
const ttlByTf: Record<Timeframe, number> = {
  '1m': 2 * 86400,
  '4h': 180 * 86400,
};

@Injectable()
export class RunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger({ name: 'worker' });
  private redis!: RedisClientType;
  private marketLoop?: SequentialLoop;
  private deliveryLoop?: SequentialLoop;
  private delivery?: NotificationDelivery;
  private readonly history = new Map<
    Timeframe,
    { currentOpen: number; candles: Candle[] }
  >();
  private source = 'mock';

  async onModuleInit(): Promise<void> {
    this.source = (process.env['DATA_SOURCE'] ?? 'mock').toLowerCase();
    if (!['mock', 'binance'].includes(this.source))
      throw new Error('DATA_SOURCE must be binance or mock');
    this.redis = await connectRedis();
    const delivery = new NotificationDelivery(this.redis, (error) =>
      this.logger.error(
        { err: error },
        'Telegram delivery failed; pending retained',
      ),
    );
    this.delivery = delivery;
    this.marketLoop = new SequentialLoop(
      () => this.processCycle(),
      1000,
      (error) => this.logger.error({ err: error }, 'Market cycle failed'),
    );
    this.deliveryLoop = new SequentialLoop(
      () => delivery.flush(),
      250,
      (error) => this.logger.error({ err: error }, 'Delivery cycle failed'),
    );
    this.logger.info(
      {
        symbol,
        tfs,
        source: this.source,
        mode: process.env['RUNNER_MODE'] ?? 'single',
      },
      'Runner started',
    );
    this.deliveryLoop.start();
    this.marketLoop.start();
  }

  private async processCycle(): Promise<void> {
    if (this.source === 'mock') {
      await Promise.all(
        tfs.map((tf) =>
          this.processMock(tf).catch((error) =>
            this.logTimeframeError(tf, error),
          ),
        ),
      );
      return;
    }
    // Exchange clock determines CLOSED history, regardless of local clock or mock scale.
    const clockRequestStarted = performance.now();
    const serverTime = await fetchBinanceTime();
    const ready = await Promise.all(
      tfs.map(async (tf) => {
        try {
          const currentOpen =
            Math.floor(serverTime / timeframeMs(tf)) * timeframeMs(tf);
          let history = this.history.get(tf);
          if (!history || history.currentOpen !== currentOpen) {
            const candles = await syncBinanceCandles({
              redis: this.redis,
              symbol,
              tf,
              limit: 200,
              ttlSeconds: ttlByTf[tf],
              serverTime,
            });
            history = { currentOpen, candles };
            this.history.set(tf, history);
          }
          return { tf, ...history };
        } catch (error) {
          this.logTimeframeError(tf, error);
          return null;
        }
      }),
    );
    if (!ready.some(Boolean)) return;
    // One price response shared by both timeframes, fetched after history sync.
    const observation = await fetchBinancePrice(symbol);
    // Conservative upper bound: skip a timeframe if this request sequence could
    // have crossed its candle boundary. The next cycle synchronizes it first.
    const latestPossibleTime =
      serverTime + (performance.now() - clockRequestStarted);
    await Promise.all(
      ready.map(async (item) => {
        if (!item) return;
        const { tf, currentOpen, candles } = item;
        if (
          Math.floor(latestPossibleTime / timeframeMs(tf)) * timeframeMs(tf) !==
          currentOpen
        )
          return;
        try {
          const event = await processLiveObservation({
            redis: this.redis,
            symbol,
            tf,
            candles,
            ...observation,
            candleOpenTime: currentOpen,
          });
          if (event)
            this.logger.info(
              {
                id: event.id,
                tf,
                signal: event.signal,
                observedAt: event.observedAt,
                detectedAt: event.detectedAt,
              },
              'SMA cross LIVE',
            );
        } catch (error) {
          this.logTimeframeError(tf, error);
        }
      }),
    );
  }

  private logTimeframeError(tf: Timeframe, error: unknown): void {
    this.logger.error({ err: error, tf }, 'Timeframe processing failed');
  }

  private async processMock(tf: Timeframe): Promise<void> {
    const { candles, appended } = await appendMockCandle({
      redis: this.redis,
      symbol,
      tf,
      limit: 200,
      ttlSeconds: ttlByTf[tf],
    });
    if (!appended) return;
    const cross = smaCrossAt({
      closes: candles.map((c) => c.close),
      fast: 10,
      slow: 50,
      index: candles.length - 1,
    });
    if (
      cross.signal === 'none' ||
      cross.now.fast === null ||
      cross.now.slow === null ||
      cross.prev.fast === null ||
      cross.prev.slow === null
    )
      return;
    const event: ClosedSignalEvent = {
      type: 'sma_cross',
      mode: 'closed',
      symbol,
      tf,
      fast: 10,
      slow: 50,
      signal: cross.signal,
      ts: appended.closeTime,
      now: { fast: cross.now.fast, slow: cross.now.slow },
      prev: { fast: cross.prev.fast, slow: cross.prev.slow },
    };
    const id = randomUUID();
    const recipients = await notificationRecipients(this.redis, symbol, tf);
    const transaction = this.redis
      .multi()
      .set(`signals:last:sma_cross:${symbol}:${tf}`, JSON.stringify(event));
    if (recipients.length)
      transaction.hSet(
        pendingNotificationsKey,
        id,
        JSON.stringify(pendingNotification(id, event, recipients)),
      );
    await transaction.exec();
  }

  async onModuleDestroy(): Promise<void> {
    this.delivery?.stop();
    // Stop scheduling first; let bounded in-flight HTTP calls finish, then close Redis.
    await Promise.all([this.marketLoop?.stop(), this.deliveryLoop?.stop()]);
    await closeRedis();
  }
}
