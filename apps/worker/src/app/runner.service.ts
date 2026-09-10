import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Candle, ClosedSignalEvent } from '@pzv-terminal/shared-types';
import type { RedisClientType } from 'redis';
import { MONITORING_STRATEGY as strategy } from '@pzv-terminal/core-config';
import { createLogger } from '@pzv-terminal/core-logger';
import { closeRedis, connectRedis } from '@pzv-terminal/core-redis';
import {
  BinanceHttpError,
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

type ActiveTimeframe = (typeof strategy.timeframes)[number];

@Injectable()
export class RunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger({ name: 'worker' });
  private redis!: RedisClientType;
  private marketLoop?: SequentialLoop;
  private deliveryLoop?: SequentialLoop;
  private delivery?: NotificationDelivery;
  private readonly history = new Map<
    string,
    { currentOpen: number; candles: Candle[] }
  >();
  private source = 'mock';
  private readonly retries = new Map<
    string,
    { attempts: number; at: number }
  >();
  private binanceRetryAt = 0;

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
        strategy,
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
        strategy.symbols.flatMap((symbol) =>
          strategy.timeframes.map((tf) =>
            this.processMock(symbol, tf).catch((error) =>
              this.logger.error(
                { err: error, symbol, tf },
                'Mock processing failed',
              ),
            ),
          ),
        ),
      );
      return;
    }
    if (performance.now() < this.binanceRetryAt || !this.retryDue('time'))
      return;
    const clockRequestStarted = performance.now();
    let serverTime: number;
    try {
      serverTime = await fetchBinanceTime();
      this.retries.delete('time');
    } catch (error) {
      this.recordFailure('time', error);
      return;
    }
    // Four independent symbols, with at most two history requests per symbol.
    await Promise.all(
      strategy.symbols.map((symbol) =>
        this.processBinanceSymbol(symbol, serverTime, clockRequestStarted),
      ),
    );
  }

  private async processBinanceSymbol(
    symbol: string,
    serverTime: number,
    clockRequestStarted: number,
  ): Promise<void> {
    const ready = await Promise.all(
      strategy.timeframes.map(async (tf) => {
        const key = `${symbol}:${tf}`;
        try {
          const currentOpen =
            Math.floor(serverTime / timeframeMs(tf)) * timeframeMs(tf);
          let history = this.history.get(key);
          if (
            !history ||
            history.currentOpen !== currentOpen ||
            history.candles.length !== strategy.historyLimit
          ) {
            if (
              !this.retryDue(`history:${key}`) ||
              performance.now() < this.binanceRetryAt
            )
              return null;
            const candles = await syncBinanceCandles({
              redis: this.redis,
              symbol,
              tf,
              limit: strategy.historyLimit,
              ttlSeconds: strategy.historyTtlSeconds[tf],
              serverTime,
            });
            history = { currentOpen, candles };
            this.history.set(key, history);
            this.retries.delete(`history:${key}`);
          }
          return { tf, ...history };
        } catch (error) {
          this.recordFailure(`history:${key}`, error);
          return null;
        }
      }),
    );
    if (
      !ready.some(Boolean) ||
      !this.retryDue(`price:${symbol}`) ||
      performance.now() < this.binanceRetryAt
    )
      return;
    let observation: Awaited<ReturnType<typeof fetchBinancePrice>>;
    try {
      // One price per symbol, shared by its 4h and 1d streams.
      observation = await fetchBinancePrice(symbol);
      this.retries.delete(`price:${symbol}`);
    } catch (error) {
      this.recordFailure(`price:${symbol}`, error);
      return;
    }
    const latestPossibleTime =
      serverTime + (performance.now() - clockRequestStarted);
    await Promise.all(
      ready.map(async (item) => {
        if (!item) return;
        const { tf, currentOpen, candles } = item;
        // Do not combine a new interval's price with the previous interval's window.
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
                symbol,
                tf,
                action: event.action,
                observedAt: event.observedAt,
                detectedAt: event.detectedAt,
              },
              'SMA cross LIVE',
            );
        } catch (error) {
          this.logger.error(
            { err: error, symbol, tf },
            'Live processing failed',
          );
        }
      }),
    );
  }

  private retryDue(key: string): boolean {
    return performance.now() >= (this.retries.get(key)?.at ?? 0);
  }

  private recordFailure(key: string, error: unknown): void {
    const attempts = (this.retries.get(key)?.attempts ?? 0) + 1;
    const delay = Math.max(
      Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5)),
      error instanceof BinanceHttpError ? error.retryAfterMs : 0,
    );
    const at = performance.now() + delay;
    this.retries.set(key, { attempts, at });
    // Binance weight limits are shared by IP, so respect a rate-limit response
    // across all streams. Ordinary stream errors remain local.
    if (
      error instanceof BinanceHttpError &&
      (error.status === 429 || error.status === 418)
    )
      this.binanceRetryAt = Math.max(this.binanceRetryAt, at);
    this.logger.error(
      { err: error, key, retryInMs: delay },
      'Binance request failed',
    );
  }

  private async processMock(
    symbol: string,
    tf: ActiveTimeframe,
  ): Promise<void> {
    const { candles, appended } = await appendMockCandle({
      redis: this.redis,
      symbol,
      tf,
      limit: strategy.historyLimit,
      ttlSeconds: strategy.historyTtlSeconds[tf],
    });
    if (!appended) return;
    const cross = smaCrossAt({
      closes: candles.map((c) => c.close),
      fast: strategy.fast,
      slow: strategy.slow,
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
      fast: strategy.fast,
      slow: strategy.slow,
      signal: cross.signal,
      action: cross.signal === 'bull_cross' ? 'BUY' : 'SELL',
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
