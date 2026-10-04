import { Body, Controller, Post } from '@nestjs/common';
import { BacktestService } from './backtest.service';

@Controller('backtests')
export class BacktestController {
  constructor(private readonly backtests: BacktestService) {}

  @Post()
  run(@Body() body: Record<string, unknown>) {
    return this.backtests.run(body);
  }
}
