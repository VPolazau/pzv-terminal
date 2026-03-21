import { Global, Module } from '@nestjs/common';
import { connectRedis } from '@pzv-terminal/core-redis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: async () => {
        const redis = await connectRedis();
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
