import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from '../health/health.controller';
import { VersionController } from '../version/version.controller';
import { MarketController } from '../market/market.controller';
import { IndicatorsController } from '../indicators/indicators.controller';
import { SignalsController } from '../signals/signals.controller';
import { LastSignalsController } from '../signals/last-signals.controller';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { RedisModule } from '../redis/redis.module';
import { HistoricalCandleRepository } from '../market/historical-candle.repository';
import { HistoricalCandleService } from '../market/historical-candle.service';
import { BacktestController } from '../backtest/backtest.controller';
import { BacktestService } from '../backtest/backtest.service';

@Module({
  imports: [RedisModule],
  controllers: [
    AppController,
    HealthController,
    VersionController,
    MarketController,
    IndicatorsController,
    SignalsController,
    LastSignalsController,
    SubscriptionsController,
    BacktestController,
  ],
  providers: [
    AppService,
    {
      provide: HistoricalCandleRepository,
      useFactory: () => new HistoricalCandleRepository(),
    },
    HistoricalCandleService,
    BacktestService,
  ],
})
export class AppModule {}
