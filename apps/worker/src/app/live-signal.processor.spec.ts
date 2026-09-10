import { liveStateKey, processLiveObservation } from './live-signal.processor';
import { pendingNotificationsKey } from './notification-delivery';
import { candle, memoryRedis } from '../../test-support/redis';

describe('persisted live transitions', () => {
  beforeEach(() =>
    jest.replaceProperty(process, 'env', { RUNNER_MODE: 'subs' }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('initializes silently and atomically persists three distinct events in one candle', async () => {
    const memory = memoryRedis();
    memory.sMembers.mockResolvedValue(['subscriber']);
    const params = {
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '4h' as const,
      candles: Array.from({ length: 300 }, (_, i) => candle(i, '4h')),
      observedAt: 4320000000,
      candleOpenTime: 4320000000,
    };
    expect(await processLiveObservation({ ...params, price: 90 })).toBeNull();
    expect(memory.hashes.size).toBe(0);
    const events = [];
    for (const price of [110, 90, 110])
      events.push(await processLiveObservation({ ...params, price }));
    expect(events.map((e) => e?.signal)).toEqual([
      'bull_cross',
      'bear_cross',
      'bull_cross',
    ]);
    expect(new Set(events.map((e) => e?.id)).size).toBe(3);
    expect(events.map((e) => e?.action)).toEqual(['BUY', 'SELL', 'BUY']);
    expect(events[0]).toMatchObject({ fast: 1, slow: 238 });
    expect(
      Object.keys(memory.hashes.get(pendingNotificationsKey) ?? {}),
    ).toHaveLength(3);
    expect(events[0]).toMatchObject({
      mode: 'live',
      source: 'binance',
      price: 110,
      candleOpenTime: 4320000000,
      candleCloseTime: 4334399999,
      observedAt: 4320000000,
    });
    // A fresh invocation reloads state from Redis; no process-local baseline.
    expect(await processLiveObservation({ ...params, price: 110 })).toBeNull();
    expect(
      JSON.parse(memory.strings.get(liveStateKey('BTCUSDT', '4h')) ?? '{}')
        .direction,
    ).toBe('above');
  });
  it('does not advance state if transaction cannot be committed', async () => {
    const memory = memoryRedis();
    memory.sMembers.mockResolvedValue(['subscriber']);
    const params = {
      redis: memory.redis,
      symbol: 'BTCUSDT',
      tf: '4h' as const,
      candles: Array.from({ length: 300 }, (_, i) => candle(i, '4h')),
      observedAt: 4320000000,
      candleOpenTime: 4320000000,
    };
    await processLiveObservation({ ...params, price: 90 });
    const before = memory.strings.get(liveStateKey('BTCUSDT', '4h'));
    const transaction = memory.multi();
    transaction.exec.mockRejectedValueOnce(new Error('Redis unavailable'));
    memory.multi.mockReturnValueOnce(transaction);
    await expect(
      processLiveObservation({ ...params, price: 110 }),
    ).rejects.toThrow('Redis unavailable');
    expect(memory.strings.get(liveStateKey('BTCUSDT', '4h'))).toBe(before);
    expect(memory.hashes.size).toBe(0);
  });
});

describe('SMA1/238 stream identities', () => {
  beforeEach(() =>
    jest.replaceProperty(process, 'env', { RUNNER_MODE: 'subs' }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('does not read old 10:50 state and keeps symbols/timeframes independent across restart', async () => {
    const memory = memoryRedis();
    memory.sMembers.mockResolvedValue(['subscriber']);
    const symbols = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'TAOUSDT'];
    const timeframes = ['4h', '1d'] as const;
    const inputs = symbols.flatMap((symbol) =>
      timeframes.map((tf) => ({
        redis: memory.redis,
        symbol,
        tf,
        candles: Array.from({ length: 300 }, (_, i) =>
          candle(i, tf, 100, symbol),
        ),
        observedAt: 400 * 86400000,
        candleOpenTime: 400 * 86400000,
      })),
    );
    memory.strings.set(
      'signals:live_state:sma_cross:binance:BTCUSDT:4h:10:50',
      JSON.stringify({
        direction: 'above',
        now: { fast: 110, slow: 100 },
        observedAt: 1,
      }),
    );
    for (const p of inputs)
      expect(await processLiveObservation({ ...p, price: 90 })).toBeNull();
    expect(memory.hashes.size).toBe(0);
    expect(new Set(inputs.map((p) => liveStateKey(p.symbol, p.tf))).size).toBe(
      8,
    );
    const buy = await processLiveObservation({ ...inputs[0], price: 110 });
    expect(buy).toMatchObject({
      action: 'BUY',
      fast: 1,
      slow: 238,
      symbol: 'BTCUSDT',
      tf: '4h',
    });
    for (const p of inputs.slice(1))
      expect(await processLiveObservation({ ...p, price: 90 })).toBeNull();
    // Calls reload persisted state: the same side after restart is silent.
    expect(
      await processLiveObservation({ ...inputs[0], price: 110 }),
    ).toBeNull();
    expect(
      await processLiveObservation({ ...inputs[0], price: 90 }),
    ).toMatchObject({ action: 'SELL' });
    for (const p of inputs.slice(1)) {
      const event = await processLiveObservation({ ...p, price: 110 });
      expect(event).toMatchObject({
        action: 'BUY',
        symbol: p.symbol,
        tf: p.tf,
      });
      expect(
        JSON.parse(
          memory.strings.get(`signals:last:sma_cross:${p.symbol}:${p.tf}`) ??
            '{}',
        ).id,
      ).toBe(event?.id);
    }
    expect(
      Object.keys(memory.hashes.get(pendingNotificationsKey) ?? {}),
    ).toHaveLength(9);
  });
});
