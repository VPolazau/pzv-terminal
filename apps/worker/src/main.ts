import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { getConfig } from '@pzv-terminal/core-config';
import { createLogger } from '@pzv-terminal/core-logger';
import type { Ticker } from '@pzv-terminal/shared-types';
import { redisSetJson } from "@pzv-terminal/core-redis";

async function bootstrap() {
  const config = getConfig();
  const logger = createLogger({ name: config.WORKER_NAME });

  const app = await NestFactory.createApplicationContext(AppModule);

  logger.info('Worker started');

  setInterval(() => {
    logger.debug('Worker heartbeat');
  }, 60_000);

  setInterval(async () => {
    const t: Ticker = {
      symbol: 'BTCUSDT',
      price: 60000 + Math.round(Math.random() * 1000),
      ts: Date.now(),
      source: 'mock',
    };

    await redisSetJson(`market:ticker:${t.symbol}`, t);
    logger.info({ t }, 'Ticker updated');
  }, 10_000);
}

bootstrap();
