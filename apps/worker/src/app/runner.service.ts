import { Injectable, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@pzv-terminal/core-logger';
import { connectRedis, getJson, setJson } from '@pzv-terminal/core-redis';
import { smaCrossAt, sendTelegramMessage } from '@pzv-terminal/shared-utils';
import { appendMockCandle, currentCloseTime } from '../jobs/candles.job';
import type { SignalEvent, Timeframe } from '@pzv-terminal/shared-types';

const symbol = 'BTCUSDT';
const tfs = ['1m', '15m', '45m', '1h', '4h', '1d'] as const;

const limitByTf: Record<(typeof tfs)[number], number> = {
  '1m': 200,
  '15m': 200,
  '45m': 200,
  '1h': 200,
  '4h': 200,
  '1d': 400,
};

const ttlByTf: Record<(typeof tfs)[number], number> = {
  '1m': 2 * 24 * 60 * 60,
  '15m': 14 * 24 * 60 * 60,
  '45m': 30 * 24 * 60 * 60,
  '1h': 60 * 24 * 60 * 60,
  '4h': 180 * 24 * 60 * 60,
  '1d': 365 * 24 * 60 * 60,
};

function signalsKey(tf: Timeframe) {
  return `signals:last:sma_cross:${symbol}:${tf}`;
}
function dedupeKey(tf: Timeframe) {
  return `signals:last_sent:sma_cross:${symbol}:${tf}`;
}
function lastCloseKey(tf: Timeframe) {
  return `market:last_close:${symbol}:${tf}`;
}

@Injectable()
export class RunnerService implements OnModuleInit {
  private readonly logger = createLogger({ name: 'worker' });

  async onModuleInit() {
    const redis = await connectRedis();
    const mode = (process.env['RUNNER_MODE'] ?? 'single').toLowerCase();

    this.logger.info({ symbol, tfs }, 'Runner started');
    this.logger.info({ mode }, 'Runner mode');

    setInterval(async () => {
      try {
        const token = process.env['TELEGRAM_BOT_TOKEN'];

        this.logger.debug({ mode }, 'Runner mode');

        for (const tf of tfs) {
          const limit = limitByTf[tf];
          const ttlSeconds = ttlByTf[tf];

          const expectedClose = currentCloseTime(tf);
          const processed = Number((await redis.get(lastCloseKey(tf))) ?? 0);

          // если эту “закрытую свечу” уже обработали - ничего не делаем
          if (processed === expectedClose) {
            this.logger.debug({ tf }, 'Skip - candle not closed yet');
            continue;
          }

          const { candles, appended } = await appendMockCandle({
            redis,
            symbol,
            tf,
            limit,
            ttlSeconds,
          });

          // помечаем обработку (храним closeTime последней свечи)
          await redis.set(lastCloseKey(tf), String(expectedClose), {
            EX: ttlSeconds,
          });

          const closes = candles.map((c) => c.close);
          const idx = closes.length - 1;

          const cross = smaCrossAt({ closes, fast: 10, slow: 50, index: idx });

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
              fast: 10,
              slow: 50,
              signal: cross.signal,
              ts: appended.closeTime,
              now: { fast: cross.now.fast, slow: cross.now.slow },
              prev: { fast: cross.prev.fast, slow: cross.prev.slow },
            };

            await setJson(redis, signalsKey(tf), event);
            this.logger.warn({ tf, signal: event.signal }, 'SMA cross signal!');

            if (!token) {
              this.logger.debug('Telegram token is not set. Skip notify.');
              continue;
            }

            const dKey = dedupeKey(tf);
            const lastSent = await getJson<{
              candleCloseTime: number;
              signal: string;
            }>(redis, dKey);

            const mark = {
              candleCloseTime: appended.closeTime,
              signal: event.signal,
            };
            const shouldSend =
              !lastSent ||
              lastSent.candleCloseTime !== mark.candleCloseTime ||
              lastSent.signal !== mark.signal;

            if (shouldSend) {
              const emoji = event.signal === 'bull_cross' ? '🟢' : '🔴';
              const text =
                `${emoji} SMA cross\n` +
                `Symbol: ${event.symbol}\n` +
                `TF: ${event.tf}\n` +
                `Fast/Slow: ${event.fast}/${event.slow}\n` +
                `Signal: ${event.signal}\n` +
                `candle close: ${new Date(appended.closeTime).toISOString()}\n`;

              if (mode === 'subs') {
                const recipientsKey = `subs:pair:${symbol}:${tf}`;
                const chatIds = await redis.sMembers(recipientsKey);

                if (chatIds.length === 0) {
                  this.logger.debug({ tf }, 'No subscribers - skip notify');
                  continue;
                }

                let sent = 0;

                for (const cid of chatIds) {
                  try {
                    await sendTelegramMessage({ token, chatId: cid, text });
                    sent++;
                  } catch (e) {
                    this.logger.error(
                      { err: e, tf, chatId: cid },
                      'Telegram send failed',
                    );
                  }
                }

                if (sent > 0) {
                  await setJson(redis, dKey, mark, ttlSeconds);
                }
              } else {
                const chatId = process.env['TELEGRAM_CHAT_ID'];
                if (!chatId) {
                  this.logger.debug(
                    'TELEGRAM_CHAT_ID is not set. Skip notify.',
                  );
                  continue;
                }

                try {
                  await sendTelegramMessage({ token, chatId, text });
                  await setJson(redis, dKey, mark, ttlSeconds);
                } catch (e) {
                  this.logger.error(
                    { err: e, tf, chatId },
                    'Telegram send failed',
                  );
                }
              }
            }
          }
        }
      } catch (e) {
        this.logger.error({ err: e }, 'Tick failed');
      }
    }, 10_000);
  }
}
