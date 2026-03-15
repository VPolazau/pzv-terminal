import type { RedisClientType } from 'redis';

export async function setJson<T>(
  redis: RedisClientType,
  key: string,
  value: T,
): Promise<void> {
  await redis.set(key, JSON.stringify(value));
}

export async function getJson<T>(
  redis: RedisClientType,
  key: string,
): Promise<T | null> {
  const raw = await redis.get(key);

  // В некоторых типизациях redis raw может быть string | {} | null
  if (typeof raw !== 'string' || raw.length === 0) return null;

  return JSON.parse(raw) as T;
}
