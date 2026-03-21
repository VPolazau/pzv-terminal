import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { getConfig } from '@pzv-terminal/core-config';
import { createLogger } from '@pzv-terminal/core-logger';

async function bootstrap() {
  const config = getConfig();
  const logger = createLogger({ name: config.WORKER_NAME });

  await NestFactory.createApplicationContext(AppModule);
  logger.info('Worker started');
}

bootstrap();
