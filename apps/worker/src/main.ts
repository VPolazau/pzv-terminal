import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { getConfig } from '@pzv-terminal/core-config';
import { createLogger } from '@pzv-terminal/core-logger';
import { sendTelegramMessage } from '@pzv-terminal/shared-utils';
import { connectRedis, getJson, setJson } from '@pzv-terminal/core-redis';
import { writeMockCandles } from './jobs/candles.job';
import type { SignalEvent } from '@pzv-terminal/shared-types';
import { smaCrossAt } from '@pzv-terminal/shared-utils';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function bootstrap() {
  const config = getConfig();
  const logger = createLogger({ name: config.WORKER_NAME });

  await NestFactory.createApplicationContext(AppModule);

  const redis = await connectRedis();

  logger.info('Worker started');

  const symbol = 'BTCUSDT';
  const tf = '1m' as const;
  const limit = 120;

  setInterval(async () => {
    try {
      const candles = await writeMockCandles({ redis, symbol, tf, limit });

      const closes = candles.map((c) => c.close);
      const idx = closes.length - 1;

      const fast = 10;
      const slow = 50;

      const cross = smaCrossAt({ closes, fast, slow, index: idx });

      if (
        cross.signal !== 'none' &&
        cross.now.fast !== null &&
        cross.now.slow !== null &&
        cross.prev.fast !== null &&
        cross.prev.slow !== null
      ) {
        const event: SignalEvent = {
          type: 'sma_cross',
          symbol,
          tf,
          fast,
          slow,
          signal: cross.signal,
          ts: Date.now(),
          now: { fast: cross.now.fast, slow: cross.now.slow },
          prev: { fast: cross.prev.fast, slow: cross.prev.slow },
        };

        await setJson(redis, `signals:last:sma_cross:${symbol}:${tf}`, event);
        logger.warn({ event }, 'SMA cross signal!');

        const token = process.env['TELEGRAM_BOT_TOKEN'];
        const chatId = process.env['TELEGRAM_CHAT_ID'];

        if (!token || !chatId) {
          logger.warn('Telegram env is not set. Skipping notify.');
        } else {
          const dedupeKey = `signals:last_sent:sma_cross:${symbol}:${tf}`;
          const lastSent = await getJson<{ ts: number; signal: string }>(
            redis,
            dedupeKey,
          );

          // Не шлём повторно одно и то же событие
          if (
            !lastSent ||
            lastSent.ts !== event.ts ||
            lastSent.signal !== event.signal
          ) {
            const emoji = event.signal === 'bull_cross' ? '🟢' : '🔴';
            const text =
              `${emoji} SMA cross\n` +
              `Symbol: ${event.symbol}\n` +
              `TF: ${event.tf}\n` +
              `Fast/Slow: ${event.fast}/${event.slow}\n` +
              `Signal: ${event.signal}\n` +
              `now: ${event.now.fast.toFixed(2)} / ${event.now.slow.toFixed(2)}\n` +
              `prev: ${event.prev.fast.toFixed(2)} / ${event.prev.slow.toFixed(2)}`;

            try {
              await sendTelegramMessage({ token, chatId, text });
              await setJson(redis, dedupeKey, {
                ts: event.ts,
                signal: event.signal,
              });
              logger.info('Telegram notification sent');
            } catch (e) {
              logger.error({ err: e }, 'Telegram notification failed');
            }
          } else {
            logger.debug('Skip telegram - duplicate event');
          }
        }
      }

      logger.info({ symbol, tf }, 'Candles updated');
    } catch (e) {
      logger.error({ err: e }, 'Worker tick failed');
    }
  }, 10_000);

  setInterval(() => logger.debug('Worker heartbeat'), 60_000);
}

bootstrap();
