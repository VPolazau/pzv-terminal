import { Controller, Get, Query } from '@nestjs/common';
import type { LiveSignalRecord } from '@pzv-terminal/shared-types';
import { LiveSignalHistoryService } from './live-signal-history.service';

@Controller('signals')
export class LiveSignalHistoryController {
  constructor(private readonly history: LiveSignalHistoryService) {}

  @Get('history')
  historyList(
    @Query('symbol') symbol?: string,
    @Query('tf') tf?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('order') order?: string,
  ): LiveSignalRecord[] {
    return this.history.find({ symbol, tf, from, to, limit, order });
  }
}
