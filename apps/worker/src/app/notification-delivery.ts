import type { SignalEvent } from '@pzv-terminal/shared-types';
import type { RedisClientType } from 'redis';
import {
  sendTelegramMessage,
  TelegramDeliveryError,
} from '@pzv-terminal/shared-utils';

export type PendingNotification = {
  id: string;
  event: SignalEvent;
  recipients: {
    chatId: string;
    deliveredAt?: number;
    attempts: number;
    retryAt: number;
  }[];
};

export const pendingNotificationsKey = 'signals:pending:telegram';

export async function notificationRecipients(
  redis: RedisClientType,
  symbol: string,
  tf: string,
): Promise<string[]> {
  if (process.env['RUNNER_MODE'] === 'subs')
    return redis.sMembers(`subs:pair:${symbol}:${tf}`);
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  return chatId ? [chatId] : [];
}

export function pendingNotification(
  id: string,
  event: SignalEvent,
  chatIds: string[],
): PendingNotification {
  return {
    id,
    event,
    recipients: chatIds.map((chatId) => ({ chatId, attempts: 0, retryAt: 0 })),
  };
}

export function notificationText(event: SignalEvent): string {
  const action =
    event.action ?? (event.signal === 'bull_cross' ? 'BUY' : 'SELL');
  const heading = `${action === 'BUY' ? '🟢' : '🔴'} ${action} — SMA${event.fast} crossed SMA${event.slow} — ${event.mode === 'live' ? 'LIVE / INTRABAR' : 'CLOSED (mock)'}`;
  const lines = [
    heading,
    `Symbol: ${event.symbol}`,
    `TF: ${event.tf}`,
    `SMA: ${event.fast} / ${event.slow}`,
    `Signal: ${event.signal}`,
  ];
  if (event.mode === 'live') {
    lines.push(
      `Price: ${event.price}`,
      `SMA${event.slow}: ${event.now.slow}`,
      `Observed: ${new Date(event.observedAt).toISOString()}`,
      `Detected: ${new Date(event.detectedAt).toISOString()}`,
      `Candle: ${new Date(event.candleOpenTime).toISOString()} → ${new Date(event.candleCloseTime).toISOString()} (forming)`,
      `Event: ${event.id}`,
    );
  } else lines.push(`Candle close: ${new Date(event.ts).toISOString()}`);
  if (event.suggestedStopLoss !== undefined)
    lines.push(`Suggested SL: ${event.suggestedStopLoss}`);
  return lines.join('\n');
}

export class NotificationDelivery {
  private stopped = false;
  // If Redis acknowledgement fails after Telegram success, do not resend in
  // this process while retrying persistence. Cross-process exactly-once is not
  // possible because Telegram sendMessage has no idempotency key.
  private readonly acknowledged = new Map<string, number>();

  constructor(
    private readonly redis: RedisClientType,
    private readonly onError: (error: unknown) => void,
  ) {}

  async flush(): Promise<void> {
    if (this.stopped) return;
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) return;
    const pending = Object.values(
      await this.redis.hGetAll(pendingNotificationsKey),
    )
      .map((raw) => JSON.parse(raw) as PendingNotification)
      .sort((a, b) => a.event.ts - b.event.ts);
    // One failed/slow timeframe must not block the other. Within a timeframe
    // preserve event order for each recipient, including bull -> bear -> bull.
    const groups = new Map<string, PendingNotification[]>();
    for (const item of pending) {
      const key = `${item.event.symbol}:${item.event.tf}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    await Promise.all(
      [...groups.values()].map((items) =>
        this.deliverGroup(items, token).catch(this.onError),
      ),
    );
  }

  private async deliverGroup(
    items: PendingNotification[],
    token: string,
  ): Promise<void> {
    const blocked = new Set<string>();
    for (const item of items) {
      if (this.stopped) return;
      for (const recipient of item.recipients) {
        if (this.stopped) return;
        const acknowledgementKey = `${item.id}:${recipient.chatId}`;
        recipient.deliveredAt ??= this.acknowledged.get(acknowledgementKey);
        if (recipient.deliveredAt) {
          await this.redis.hSet(
            pendingNotificationsKey,
            item.id,
            JSON.stringify(item),
          );
          continue;
        }
        if (blocked.has(recipient.chatId)) continue;
        if (recipient.retryAt > Date.now()) {
          blocked.add(recipient.chatId);
          continue;
        }
        try {
          await sendTelegramMessage({
            token,
            chatId: recipient.chatId,
            text: notificationText(item.event),
          });
          recipient.deliveredAt = Date.now();
          this.acknowledged.set(acknowledgementKey, recipient.deliveredAt);
        } catch (error) {
          recipient.attempts++;
          const retryAfter =
            error instanceof TelegramDeliveryError
              ? (error.retryAfterSeconds ?? 0)
              : 0;
          recipient.retryAt =
            Date.now() +
            Math.max(
              retryAfter * 1000,
              Math.min(30_000, 1000 * 2 ** Math.min(recipient.attempts - 1, 5)),
            );
          blocked.add(recipient.chatId);
          this.onError(error);
        }
        await this.redis.hSet(
          pendingNotificationsKey,
          item.id,
          JSON.stringify(item),
        );
      }
      if (
        item.recipients.every(
          (recipient) => recipient.deliveredAt !== undefined,
        )
      ) {
        await this.redis.hDel(pendingNotificationsKey, item.id);
        for (const recipient of item.recipients)
          this.acknowledged.delete(`${item.id}:${recipient.chatId}`);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
