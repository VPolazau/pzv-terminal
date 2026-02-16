import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from "../health/health.controller";
import { VersionController } from "../version/version.controller";
import { MarketController } from "../market/market.controller";

@Module({
  imports: [],
  controllers: [AppController, HealthController, VersionController, MarketController],
  providers: [AppService],
})
export class AppModule {}
