import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;

export function getRedisClient(): RedisClientType {
  if (client) return client;

  const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  client = createClient({ url });

  client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Redis Client Error", err);
  });

  return client;
}

export async function connectRedis(): Promise<RedisClientType> {
  const c = getRedisClient();
  if (!c.isOpen) await c.connect();
  return c;
}
