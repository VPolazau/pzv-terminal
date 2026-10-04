import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  LiveSignalEvent,
  LiveSignalRecord,
  Timeframe,
} from '@pzv-terminal/shared-types';

export type LiveSignalHistoryQuery = {
  symbol?: string;
  timeframe?: Timeframe;
  from?: number;
  to?: number;
  limit?: number;
  order?: 'ASC' | 'DESC';
};

export class LiveSignalHistoryRepository {
  private readonly database: Database.Database;
  private readonly ownsDatabase: boolean;

  constructor(options: { dbPath?: string; db?: Database.Database } = {}) {
    const dbPath =
      options.dbPath ??
      process.env['SQLITE_PATH'] ??
      './data/market-history.sqlite';
    if (!options.db) mkdirSync(dirname(dbPath), { recursive: true });
    this.database = options.db ?? new Database(dbPath);
    this.ownsDatabase = !options.db;
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS live_signals (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
        signal TEXT NOT NULL,
        signal_time INTEGER NOT NULL,
        price REAL NOT NULL,
        created_at INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        fast INTEGER NOT NULL,
        slow INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        detected_at INTEGER NOT NULL,
        candle_open_time INTEGER NOT NULL,
        candle_close_time INTEGER NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        UNIQUE (symbol, timeframe, signal_time, action)
      );
      CREATE INDEX IF NOT EXISTS idx_live_signals_range
        ON live_signals (symbol, timeframe, signal_time);
    `);
  }

  save(event: LiveSignalEvent): LiveSignalRecord {
    const record: LiveSignalRecord = {
      id: event.id,
      symbol: event.symbol,
      tf: event.tf,
      action: event.action ?? (event.signal === 'bull_cross' ? 'BUY' : 'SELL'),
      signal: event.signal,
      signalTime: event.ts,
      price: event.price,
      createdAt: Date.now(),
      strategyId: `sma_cross:${event.fast}/${event.slow}`,
      fast: event.fast,
      slow: event.slow,
      observedAt: event.observedAt,
      detectedAt: event.detectedAt,
      candleOpenTime: event.candleOpenTime,
      candleCloseTime: event.candleCloseTime,
      mode: event.mode,
      source: event.source,
    };
    this.database
      .prepare(
        `
      INSERT INTO live_signals
        (id, symbol, timeframe, action, signal, signal_time, price, created_at, strategy_id,
         fast, slow, observed_at, detected_at, candle_open_time, candle_close_time, mode, source)
      VALUES
        (@id, @symbol, @tf, @action, @signal, @signalTime, @price, @createdAt, @strategyId,
         @fast, @slow, @observedAt, @detectedAt, @candleOpenTime, @candleCloseTime, @mode, @source)
      ON CONFLICT(symbol, timeframe, signal_time, action) DO NOTHING
    `,
      )
      .run(record);
    return record;
  }

  find(query: LiveSignalHistoryQuery = {}): LiveSignalRecord[] {
    const conditions = ['1 = 1'];
    const values: unknown[] = [];
    if (query.symbol) {
      conditions.push('symbol = ?');
      values.push(query.symbol);
    }
    if (query.timeframe) {
      conditions.push('timeframe = ?');
      values.push(query.timeframe);
    }
    if (query.from !== undefined) {
      conditions.push('signal_time >= ?');
      values.push(query.from);
    }
    if (query.to !== undefined) {
      conditions.push('signal_time < ?');
      values.push(query.to);
    }
    const order = query.order === 'ASC' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const rows = this.database
      .prepare(
        `
      SELECT id, symbol, timeframe, action, signal, signal_time, price, created_at,
             strategy_id, fast, slow, observed_at, detected_at, candle_open_time,
             candle_close_time, mode, source
      FROM live_signals
      WHERE ${conditions.join(' AND ')}
      ORDER BY signal_time ${order}, id ${order}
      LIMIT ?
    `,
      )
      .all(...values, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      symbol: String(row.symbol),
      tf: String(row.timeframe) as Timeframe,
      action: String(row.action) as 'BUY' | 'SELL',
      signal: String(row.signal) as LiveSignalRecord['signal'],
      signalTime: Number(row.signal_time),
      price: Number(row.price),
      createdAt: Number(row.created_at),
      strategyId: String(row.strategy_id),
      fast: Number(row.fast),
      slow: Number(row.slow),
      observedAt: Number(row.observed_at),
      detectedAt: Number(row.detected_at),
      candleOpenTime: Number(row.candle_open_time),
      candleCloseTime: Number(row.candle_close_time),
      mode: 'live',
      source: 'binance',
    }));
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}
