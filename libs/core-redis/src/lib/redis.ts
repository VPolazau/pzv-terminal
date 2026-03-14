import { createClient } from 'redis';

type AnyRedisClient = ReturnType<typeof createClient>;

let client: AnyRedisClient | null = null;

export function getRedisClient(): AnyRedisClient {
  if (client) return client;

  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  client = createClient({ url });

  client.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  return client;
}

export async function connectRedis(): Promise<AnyRedisClient> {
  const c = getRedisClient();
  if (!c.isOpen) await c.connect();
  return c;
}

// ---- УДОБНЫЕ ОБЁРТКИ ----

export async function redisGetString(key: string): Promise<string | null> {
  const c = await connectRedis();
  const value = await c.get(key);
  return typeof value === 'string' ? value : null;
}

export async function redisSetJson(key: string, value: unknown): Promise<void> {
  const c = await connectRedis();
  await c.set(key, JSON.stringify(value));
}
