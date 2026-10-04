import { Module } from '@nestjs/common';
import { RunnerService } from './runner.service';
import { LiveSignalHistoryRepository } from '@pzv-terminal/core-storage';

@Module({
  imports: [],
  controllers: [],
  providers: [
    {
      provide: LiveSignalHistoryRepository,
      useFactory: () => new LiveSignalHistoryRepository(),
    },
    RunnerService,
  ],
})
export class AppModule {}
