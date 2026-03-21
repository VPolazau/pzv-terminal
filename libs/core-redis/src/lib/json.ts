import type { RedisClientType } from 'redis';

export async function setJson<T>(
  redis: RedisClientType,
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const payload = JSON.stringify(value);

  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, payload, { EX: ttlSeconds });
    return;
  }

  await redis.set(key, payload);
}

export async function getJson<T>(
  redis: RedisClientType,
  key: string,
): Promise<T | null> {
  const raw = await redis.get(key);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return JSON.parse(raw) as T;
}
