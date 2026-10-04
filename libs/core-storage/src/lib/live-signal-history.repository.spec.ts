import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LiveSignalEvent } from '@pzv-terminal/shared-types';
import { LiveSignalHistoryRepository } from './live-signal-history.repository';

const event = (
  action: 'BUY' | 'SELL',
  ts: number,
  id = `${action}-${ts}`,
): LiveSignalEvent => ({
  id,
  type: 'sma_cross',
  mode: 'live',
  source: 'binance',
  symbol: 'BTCUSDT',
  tf: '1h',
  fast: 1,
  slow: 238,
  signal: action === 'BUY' ? 'bull_cross' : 'bear_cross',
  action,
  price: 100 + ts,
  ts,
  observedAt: ts,
  detectedAt: ts + 1,
  candleOpenTime: ts,
  candleCloseTime: ts + 3599999,
  now: { fast: 1, slow: 1 },
  prev: { fast: 1, slow: 1 },
});

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'pzv-live-signals-'));
  return {
    path: join(dir, 'signals.sqlite'),
    repo: new LiveSignalHistoryRepository({
      dbPath: join(dir, 'signals.sqlite'),
    }),
  };
}

describe('LiveSignalHistoryRepository', () => {
  it('saves BUY and SELL and deduplicates deterministic events', () => {
    const { repo } = repository();
    repo.save(event('BUY', 1));
    repo.save(event('SELL', 2));
    repo.save(event('BUY', 1, 'other-id'));
    expect(repo.find({ order: 'ASC' }).map((x) => x.action)).toEqual([
      'BUY',
      'SELL',
    ]);
    repo.close();
  });

  it('filters, orders and limits records', () => {
    const { repo } = repository();
    repo.save(event('BUY', 1));
    repo.save(event('SELL', 2));
    repo.save({ ...event('BUY', 3), symbol: 'ETHUSDT', tf: '4h' });
    expect(
      repo.find({
        symbol: 'BTCUSDT',
        timeframe: '1h',
        from: 2,
        to: 4,
        order: 'ASC',
        limit: 10,
      }),
    ).toHaveLength(1);
    expect(
      repo.find({ order: 'DESC', limit: 2 }).map((x) => x.signalTime),
    ).toEqual([3, 2]);
    repo.close();
  });

  it('persists across repository instances', () => {
    const { path, repo } = repository();
    repo.save(event('BUY', 1));
    repo.close();
    const reopened = new LiveSignalHistoryRepository({ dbPath: path });
    expect(reopened.find({ order: 'ASC' })[0]?.id).toBe('BUY-1');
    reopened.close();
  });
});
