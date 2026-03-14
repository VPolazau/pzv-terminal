import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { getConfig } from '@pzv-terminal/core-config';
import { createLogger } from '@pzv-terminal/core-logger';
import type { Ticker } from '@pzv-terminal/shared-types';
import { connectRedis } from "@pzv-terminal/core-redis";
import { writeMockCandles } from "./jobs/candles.job";

async function bootstrap() {
  const config = getConfig();
  const logger = createLogger({ name: config.WORKER_NAME });

  const app = await NestFactory.createApplicationContext(AppModule);

  const redis = await connectRedis();

  logger.info('Worker started');

  const symbol = "BTCUSDT";
  const tf = "1m" as const;
  const limit = 120;

  // сразу записали при старте
  await writeMockCandles({ redis, symbol, tf, limit });
  logger.info({ symbol, tf, limit }, "Candles initialized");

  setInterval(() => {
    logger.debug('Worker heartbeat');
  }, 60_000);

  // и обновляем раз в 10 секунд
  setInterval(async () => {
    await writeMockCandles({ redis, symbol, tf, limit });
    logger.info({ symbol, tf }, "Candles updated");
  }, 10_000);

  setInterval(() => logger.debug("Worker heartbeat"), 60_000);
}

bootstrap();
