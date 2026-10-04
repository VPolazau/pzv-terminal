import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle, Timeframe } from '@pzv-terminal/shared-types';

export type HistoricalCandleRepositoryOptions = {
  dbPath?: string;
  db?: Database.Database;
};

export class HistoricalCandleRepository {
  private readonly database: Database.Database;
  private readonly ownsDatabase: boolean;

  constructor(options: HistoricalCandleRepositoryOptions = {}) {
    const dbPath =
      options.dbPath ??
      process.env['SQLITE_PATH'] ??
      './data/market-history.sqlite';
    if (!options.db) mkdirSync(dirname(dbPath), { recursive: true });
    this.database = options.db ?? new Database(dbPath);
    this.ownsDatabase = !options.db;
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS market_candles (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        open_time INTEGER NOT NULL,
        close_time INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (symbol, timeframe, open_time)
      );
    `);
  }

  saveCandles(candles: Candle[]): void {
    if (candles.length === 0) return;
    const insert = this.database.prepare(`
      INSERT INTO market_candles
        (symbol, timeframe, open_time, close_time, open, high, low, close, volume, source)
      VALUES
        (@symbol, @timeframe, @openTime, @closeTime, @open, @high, @low, @close, @volume, @source)
      ON CONFLICT(symbol, timeframe, open_time) DO UPDATE SET
        close_time = excluded.close_time,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        source = excluded.source
    `);
    const saveBatch = this.database.transaction((batch: Candle[]) => {
      for (const candle of batch) {
        insert.run({
          symbol: candle.symbol,
          timeframe: candle.tf,
          openTime: candle.openTime,
          closeTime: candle.closeTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          source: candle.source,
        });
      }
    });
    saveBatch(candles);
  }

  findCandles(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Candle[] {
    return this.database
      .prepare(
        `
        SELECT symbol, timeframe, open_time, close_time, open, high, low, close, volume, source
        FROM market_candles
        WHERE symbol = ? AND timeframe = ? AND open_time >= ? AND open_time < ?
        ORDER BY open_time ASC
      `,
      )
      .all(symbol, timeframe, from, to)
      .map((row) => this.toCandle(row as Record<string, unknown>));
  }

  findOpenTimes(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): number[] {
    return (
      this.database
        .prepare(
          `
      SELECT open_time
      FROM market_candles
      WHERE symbol = ? AND timeframe = ? AND open_time >= ? AND open_time < ?
      ORDER BY open_time ASC
    `,
        )
        .all(symbol, timeframe, from, to) as { open_time: number }[]
    ).map((row) => row.open_time);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private toCandle(row: Record<string, unknown>): Candle {
    return {
      symbol: String(row.symbol),
      tf: String(row.timeframe) as Timeframe,
      openTime: Number(row.open_time),
      closeTime: Number(row.close_time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: String(row.source) as Candle['source'],
    };
  }
}
