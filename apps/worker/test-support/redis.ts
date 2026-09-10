import type { RedisClientType } from 'redis';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';

export function memoryRedis() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  const get = jest.fn(async (key: string) => strings.get(key) ?? null);
  const set = jest.fn(async (key: string, value: string) => {
    strings.set(key, value);
    return 'OK';
  });
  const hSet = jest.fn(async (key: string, field: string, value: string) => {
    hashes.set(key, { ...hashes.get(key), [field]: value });
    return 1;
  });
  const hDel = jest.fn(async (key: string, field: string) => {
    const hash = hashes.get(key);
    if (hash) delete hash[field];
    return 1;
  });
  const hGetAll = jest.fn(async (key: string) => ({ ...hashes.get(key) }));
  const sMembers = jest.fn<Promise<string[]>, [string]>().mockResolvedValue([]);
  const multi = jest.fn(() => {
    const operations: (() => Promise<unknown>)[] = [];
    const transaction = {
      set(key: string, value: string) {
        operations.push(() => set(key, value));
        return transaction;
      },
      hSet(key: string, field: string, value: string) {
        operations.push(() => hSet(key, field, value));
        return transaction;
      },
      exec: jest.fn(async () => {
        for (const operation of operations) await operation();
      }),
    };
    return transaction;
  });
  const client = { get, set, hSet, hDel, hGetAll, sMembers, multi };
  return {
    strings,
    hashes,
    ...client,
    redis: client as unknown as RedisClientType,
  };
}

export function candle(
  index: number,
  tf: Timeframe = '1m',
  close = 100,
  symbol = 'BTCUSDT',
): Candle {
  const step = { '1m': 60000, '4h': 14400000, '1d': 86400000 }[tf];
  return {
    symbol,
    tf,
    source: 'binance',
    openTime: index * step,
    closeTime: (index + 1) * step - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}
