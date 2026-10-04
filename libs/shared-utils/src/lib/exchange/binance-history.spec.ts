import {
  BINANCE_KLINES_PAGE_LIMIT,
  fetchBinanceHistoricalKlines,
} from './binance';

const step = 60_000;

function row(openTime: number) {
  return [openTime, '100', '110', '90', '105', '1', openTime + step - 1];
}

function mockKlines(...pages: unknown[][]) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify(pages.shift() ?? [])),
    );
}

describe('Binance historical klines pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns one Binance page in ascending order', async () => {
    const request = mockKlines([row(step * 2), row(0), row(step)]);
    const result = await fetchBinanceHistoricalKlines({
      symbol: 'BTCUSDT',
      tf: '1m',
      from: 0,
      to: step * 3,
    });
    expect(result.map((candle) => candle.openTime)).toEqual([
      0,
      step,
      step * 2,
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requests multiple pages using the next candle timestamp', async () => {
    const firstPage = Array.from(
      { length: BINANCE_KLINES_PAGE_LIMIT },
      (_, i) => row(i * step),
    );
    const request = mockKlines(firstPage, [
      row(BINANCE_KLINES_PAGE_LIMIT * step),
    ]);
    const result = await fetchBinanceHistoricalKlines({
      symbol: 'BTCUSDT',
      tf: '1m',
      from: 0,
      to: (BINANCE_KLINES_PAGE_LIMIT + 1) * step,
    });
    expect(result).toHaveLength(BINANCE_KLINES_PAGE_LIMIT + 1);
    expect(
      new URL(String(request.mock.calls[1][0])).searchParams.get('startTime'),
    ).toBe(String(BINANCE_KLINES_PAGE_LIMIT * step));
  });

  it('deduplicates candles returned at a page boundary', async () => {
    const firstPage = Array.from(
      { length: BINANCE_KLINES_PAGE_LIMIT },
      (_, i) => row(i * step),
    );
    const duplicate = (BINANCE_KLINES_PAGE_LIMIT - 1) * step;
    mockKlines(firstPage, [
      row(duplicate),
      row(BINANCE_KLINES_PAGE_LIMIT * step),
    ]);
    const result = await fetchBinanceHistoricalKlines({
      symbol: 'BTCUSDT',
      tf: '1m',
      from: 0,
      to: (BINANCE_KLINES_PAGE_LIMIT + 1) * step,
    });
    expect(result).toHaveLength(BINANCE_KLINES_PAGE_LIMIT + 1);
    expect(
      result.filter((candle) => candle.openTime === duplicate),
    ).toHaveLength(1);
  });

  it('stops at to and does not return candles after it', async () => {
    const request = mockKlines([
      row(0),
      row(step),
      row(step * 2),
      row(step * 3),
    ]);
    const result = await fetchBinanceHistoricalKlines({
      symbol: 'BTCUSDT',
      tf: '1m',
      from: 0,
      to: step * 3,
    });
    expect(result.map((candle) => candle.openTime)).toEqual([
      0,
      step,
      step * 2,
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops when Binance returns an empty page', async () => {
    const request = mockKlines([]);
    await expect(
      fetchBinanceHistoricalKlines({
        symbol: 'BTCUSDT',
        tf: '1m',
        from: 0,
        to: step,
      }),
    ).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid range before requesting Binance', async () => {
    const request = jest.spyOn(globalThis, 'fetch');
    await expect(
      fetchBinanceHistoricalKlines({
        symbol: 'BTCUSDT',
        tf: '1m',
        from: step,
        to: step,
      }),
    ).rejects.toThrow('Invalid Binance history range');
    expect(request).not.toHaveBeenCalled();
  });
});
