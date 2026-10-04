import { BadRequestException, Injectable } from '@nestjs/common';
import type { LiveSignalRecord, Timeframe } from '@pzv-terminal/shared-types';
import {
  LiveSignalHistoryRepository,
  type LiveSignalHistoryQuery,
} from '@pzv-terminal/core-storage';

const TIMEFRAMES = new Set<Timeframe>(['1m', '1h', '4h', '1d']);

@Injectable()
export class LiveSignalHistoryService {
  constructor(private readonly repository: LiveSignalHistoryRepository) {}

  find(query: {
    symbol?: string;
    tf?: string;
    from?: string;
    to?: string;
    limit?: string;
    order?: string;
  }): LiveSignalRecord[] {
    const result: LiveSignalHistoryQuery = {};
    if (query.symbol?.trim()) result.symbol = query.symbol.trim().toUpperCase();
    if (query.tf?.trim()) {
      const tf = query.tf.trim() as Timeframe;
      if (!TIMEFRAMES.has(tf))
        throw new BadRequestException('Unsupported timeframe');
      result.timeframe = tf;
    }
    if (query.from !== undefined) result.from = this.date(query.from, 'from');
    if (query.to !== undefined) result.to = this.date(query.to, 'to');
    if (
      result.from !== undefined &&
      result.to !== undefined &&
      result.from >= result.to
    )
      throw new BadRequestException('from must be before to');
    if (query.limit !== undefined) {
      const limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1)
        throw new BadRequestException('limit must be a positive integer');
      result.limit = limit;
    }
    if (query.order !== undefined) {
      const order = query.order.toUpperCase();
      if (order !== 'ASC' && order !== 'DESC')
        throw new BadRequestException('order must be ASC or DESC');
      result.order = order;
    }
    return this.repository.find(result);
  }

  private date(value: string, name: string): number {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp))
      throw new BadRequestException(`${name} must be a valid date`);
    return timestamp;
  }
}
