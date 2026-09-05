import { BadRequestException } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { IndicatorsController } from './indicators.controller';
import { SignalsController } from '../signals/signals.controller';

describe('SMA HTTP parameter validation', () => {
  const redis = {
    get: jest.fn().mockResolvedValue(null),
  } as unknown as RedisClientType;
  it.each(['10.5', '0', '-1', 'abc', 'NaN', 'Infinity', '', '501'])(
    'rejects invalid period %s with HTTP 400',
    async (value) => {
      try {
        await new IndicatorsController(redis).getSma('BTCUSDT', '1m', value);
        throw new Error('Expected validation failure');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getStatus()).toBe(400);
      }
    },
  );
  it('keeps defaults and accepts a valid integer', async () => {
    expect(await new IndicatorsController(redis).getSma()).toMatchObject({
      period: 10,
      value: null,
    });
    expect(
      await new IndicatorsController(redis).getSma('BTCUSDT', '1m', '50'),
    ).toMatchObject({ period: 50 });
  });
  it('rejects fractional fast/slow before attempting Redis connection', async () => {
    await expect(
      new SignalsController().smaCross('BTCUSDT', '1m', '10.5', '50'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      new SignalsController().smaCross('BTCUSDT', '1m', '10', '50.5'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
