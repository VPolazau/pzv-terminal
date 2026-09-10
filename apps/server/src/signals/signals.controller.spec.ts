import type { RedisClientType } from 'redis';
import { connectRedis } from '@pzv-terminal/core-redis';
import { SignalsController } from './signals.controller';
import { LastSignalsController } from './last-signals.controller';
jest.mock('@pzv-terminal/core-redis', () => ({
  ...jest.requireActual('@pzv-terminal/core-redis'),
  connectRedis: jest.fn(),
}));

describe('active strategy signal API', () => {
  it('defaults to 4h SMA1/238 and exposes BUY for a closed crossover', async () => {
    const closes = [...Array(299).fill(100), 110];
    const get = jest
      .fn()
      .mockResolvedValue(JSON.stringify(closes.map((close) => ({ close }))));
    jest
      .mocked(connectRedis)
      .mockResolvedValue({ get } as unknown as RedisClientType);
    expect(await new SignalsController().smaCross()).toMatchObject({
      symbol: 'BTCUSDT',
      tf: '4h',
      fast: 1,
      slow: 238,
      action: 'BUY',
      mode: 'closed',
    });
    expect(get).toHaveBeenCalledWith('market:candles:BTCUSDT:4h');
  });
  it('returns live BUY/SELL fields unchanged from the last-event endpoint', async () => {
    const event = {
      type: 'sma_cross',
      mode: 'live',
      symbol: 'ETHUSDT',
      tf: '1d',
      fast: 1,
      slow: 238,
      action: 'SELL',
      price: 100,
      now: { fast: 100, slow: 105 },
      suggestedStopLoss: 110,
    };
    const get = jest.fn().mockResolvedValue(JSON.stringify(event));
    expect(
      await new LastSignalsController({
        get,
      } as unknown as RedisClientType).last('ETHUSDT', '1d'),
    ).toEqual(event);
    expect(get).toHaveBeenCalledWith('signals:last:sma_cross:ETHUSDT:1d');
  });
});
