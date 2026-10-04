import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Candle } from '@pzv-terminal/shared-types';
import { timeframeMs } from '@pzv-terminal/shared-utils';
import { HistoricalCandleRepository } from './historical-candle.repository';
import { HistoricalCandleService } from './historical-candle.service';

const step = timeframeMs('1h');
const symbol = 'BTCUSDT';
const timeframe = '1h' as const;

function candle(openTime: number): Candle {
  return {
    symbol,
    tf: timeframe,
    openTime,
    closeTime: openTime + step - 1,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
    source: 'binance',
  };
}

describe('HistoricalCandleService', () => {
  let directory: string;
  let repository: HistoricalCandleRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pzv-market-'));
    repository = new HistoricalCandleRepository({
      dbPath: join(directory, 'history.sqlite'),
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads the complete range into an empty database', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue([candle(0), candle(step), candle(step * 2)]);
    const result = await new HistoricalCandleService(
      repository,
      fetcher,
    ).getHistoricalCandles(symbol, timeframe, 0, step * 3);

    expect(fetcher).toHaveBeenCalledWith({
      symbol,
      tf: timeframe,
      from: 0,
      to: step * 3,
    });
    expect(result.map((item) => item.openTime)).toEqual([0, step, step * 2]);
  });

  it('does not call Binance when the complete range is stored', async () => {
    repository.saveCandles([candle(0), candle(step), candle(step * 2)]);
    const fetcher = jest.fn();

    await new HistoricalCandleService(repository, fetcher).getHistoricalCandles(
      symbol,
      timeframe,
      0,
      step * 3,
    );

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads only the second half when the first half exists', async () => {
    repository.saveCandles([candle(0), candle(step)]);
    const fetcher = jest.fn().mockResolvedValue([candle(step * 2)]);

    await new HistoricalCandleService(repository, fetcher).getHistoricalCandles(
      symbol,
      timeframe,
      0,
      step * 3,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({
      symbol,
      tf: timeframe,
      from: step * 2,
      to: step * 3,
    });
  });

  it('loads only the first half when the second half exists', async () => {
    repository.saveCandles([candle(step), candle(step * 2)]);
    const fetcher = jest.fn().mockResolvedValue([candle(0)]);

    await new HistoricalCandleService(repository, fetcher).getHistoricalCandles(
      symbol,
      timeframe,
      0,
      step * 3,
    );

    expect(fetcher).toHaveBeenCalledWith({
      symbol,
      tf: timeframe,
      from: 0,
      to: step,
    });
  });

  it('loads only a gap in the middle', async () => {
    repository.saveCandles([candle(0), candle(step * 2)]);
    const fetcher = jest.fn().mockResolvedValue([candle(step)]);

    await new HistoricalCandleService(repository, fetcher).getHistoricalCandles(
      symbol,
      timeframe,
      0,
      step * 3,
    );

    expect(fetcher).toHaveBeenCalledWith({
      symbol,
      tf: timeframe,
      from: step,
      to: step * 2,
    });
  });

  it('does not create duplicates on a repeated request', async () => {
    const fetcher = jest.fn().mockResolvedValue([candle(0), candle(step)]);
    const service = new HistoricalCandleService(repository, fetcher);
    await service.getHistoricalCandles(symbol, timeframe, 0, step * 2);
    await service.getHistoricalCandles(symbol, timeframe, 0, step * 2);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repository.findCandles(symbol, timeframe, 0, step * 2)).toHaveLength(
      2,
    );
  });

  it('always returns candles in ascending order', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue([candle(step * 2), candle(0), candle(step)]);
    const result = await new HistoricalCandleService(
      repository,
      fetcher,
    ).getHistoricalCandles(symbol, timeframe, 0, step * 3);

    expect(result.map((item) => item.openTime)).toEqual([0, step, step * 2]);
  });

  it('keeps to exclusive', async () => {
    repository.saveCandles([candle(0), candle(step), candle(step * 2)]);
    const result = await new HistoricalCandleService(
      repository,
      jest.fn(),
    ).getHistoricalCandles(symbol, timeframe, 0, step * 2);

    expect(result.map((item) => item.openTime)).toEqual([0, step]);
  });

  it('does not retry forever when Binance has no data for a gap', async () => {
    const fetcher = jest.fn().mockResolvedValue([]);
    const result = await new HistoricalCandleService(
      repository,
      fetcher,
    ).getHistoricalCandles(symbol, timeframe, 0, step * 2);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('persists candles across repository instances', async () => {
    const dbPath = join(directory, 'persistent.sqlite');
    const first = new HistoricalCandleRepository({ dbPath });
    first.saveCandles([candle(0)]);
    first.close();

    const second = new HistoricalCandleRepository({ dbPath });
    expect(second.findCandles(symbol, timeframe, 0, step)).toEqual([candle(0)]);
    second.close();
  });
});
