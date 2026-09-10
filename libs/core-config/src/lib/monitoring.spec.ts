import { MONITORING_STRATEGY as strategy } from './monitoring';

describe('active monitoring strategy', () => {
  it('selects exactly four symbols and two long timeframes for SMA1/238', () => {
    expect(strategy.symbols).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'XRPUSDT',
      'TAOUSDT',
    ]);
    expect(strategy.timeframes).toEqual(['4h', '1d']);
    expect(strategy.fast).toBe(1);
    expect(strategy.slow).toBe(238);
    expect(strategy.historyLimit).toBe(300);
    expect(strategy.historyLimit).toBeGreaterThanOrEqual(strategy.slow - 1);
    expect(
      new Set(
        strategy.symbols.flatMap((symbol) =>
          strategy.timeframes.map((tf) => `${symbol}:${tf}`),
        ),
      ).size,
    ).toBe(8);
  });
});
