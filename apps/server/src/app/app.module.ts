import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from "../health/health.controller";
import { VersionController } from "../version/version.controller";
import { MarketController } from "../market/market.controller";
import { IndicatorsController } from "../indicators/indicators.controller";
import { SignalsController } from '../signals/signals.controller';

@Module({
  imports: [],
  controllers: [AppController, HealthController, VersionController, MarketController, IndicatorsController, SignalsController],
  providers: [AppService],
})
export class AppModule {}
