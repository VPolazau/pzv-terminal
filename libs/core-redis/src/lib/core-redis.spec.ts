import { coreRedis } from './core-redis';

describe('coreRedis', () => {
  it('should work', () => {
    expect(coreRedis()).toEqual('core-redis');
  });
});
