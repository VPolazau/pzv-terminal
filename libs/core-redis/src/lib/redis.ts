import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export function getRedisClient(): RedisClientType {
  if (client) return client;

  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

  client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      // мягкий бесконечный reconnect с бэк-оффом до 2 секунд
      reconnectStrategy: (retries) => Math.min(retries * 100, 2000),
    },
  });

  client.on('error', (err) => {
    // просто логируем, не падаем
    console.error('Redis Client Error', err);
  });

  client.on('reconnecting', () => {
    console.warn('Redis reconnecting...');
  });

  client.on('ready', () => {
    console.log('Redis ready');
  });

  return client;
}

export async function closeRedis(): Promise<void> {
  const current = client;
  client = null;
  if (!current?.isOpen) return;
  if (!current.isReady) {
    current.destroy();
    return;
  }
  const timeout = setTimeout(() => {
    if (current.isOpen) current.destroy();
  }, 2_000);
  try {
    await current.close();
  } finally {
    clearTimeout(timeout);
  }
}

export async function connectRedis(): Promise<RedisClientType> {
  const c = getRedisClient();
  if (!c.isOpen) await c.connect();
  return c;
}
