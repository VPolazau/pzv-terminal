import {
  fetchBinanceKlines,
  fetchBinancePrice,
  fetchBinanceTime,
} from './binance';

describe('Binance REST adapter', () => {
  afterEach(() => jest.restoreAllMocks());
  it('fetches a public ticker once, validates price and records receipt time', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ symbol: 'BTCUSDT', price: '123.45' })),
      );
    const result = await fetchBinancePrice('BTCUSDT');
    expect(result.price).toBe(123.45);
    expect(Number.isFinite(result.observedAt)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/ticker/price?symbol=BTCUSDT'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it.each(['bad', '0', '-1'])(
    'rejects invalid ticker price %s',
    async (price) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ symbol: 'BTCUSDT', price })),
        );
      await expect(fetchBinancePrice('BTCUSDT')).rejects.toThrow(
        'Invalid Binance',
      );
    },
  );
  it('uses exchange server time', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ serverTime: 123456 })));
    expect(await fetchBinanceTime()).toBe(123456);
  });
  it('maps OHLCV and sends explicit history range', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([[60000, '100', '110', '90', '105', '1', 119999]]),
        ),
      );
    expect(
      await fetchBinanceKlines({
        symbol: 'BTCUSDT',
        tf: '1m',
        limit: 200,
        startTime: 60000,
        endTime: 119999,
      }),
    ).toEqual([
      expect.objectContaining({
        openTime: 60000,
        closeTime: 119999,
        close: 105,
        source: 'binance',
      }),
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain(
      'startTime=60000&endTime=119999',
    );
  });
  it('rejects corrupt candles instead of turning bad prices into zero', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([[60000, '100', '110', '90', 'bad', '1', 119999]]),
        ),
      );
    await expect(
      fetchBinanceKlines({ symbol: 'BTCUSDT', tf: '1m', limit: 200 }),
    ).rejects.toThrow('Invalid Binance');
  });
});

describe('daily Binance data and rate-limit response', () => {
  afterEach(() => jest.restoreAllMocks());
  it('maps UTC 1d boundaries correctly', async () => {
    const start = 86400000;
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            [start, '100', '110', '90', '105', '1', start + 86400000 - 1],
          ]),
        ),
      );
    expect(
      await fetchBinanceKlines({ symbol: 'ETHUSDT', tf: '1d', limit: 300 }),
    ).toEqual([
      expect.objectContaining({
        symbol: 'ETHUSDT',
        tf: '1d',
        openTime: start,
        closeTime: start + 86400000 - 1,
      }),
    ]);
    expect(request.mock.calls[0][0]).toContain('interval=1d&limit=300');
  });
  it('preserves Retry-After for the runner to back off', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
      );
    await expect(fetchBinancePrice('BTCUSDT')).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    });
  });
});
