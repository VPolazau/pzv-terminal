import { BadRequestException } from '@nestjs/common';
import type { Timeframe } from '@pzv-terminal/shared-types';

const TIMEFRAMES = new Set<Timeframe>(['1m', '1h', '4h', '1d']);

export function parseHistoryRange(params: {
  symbol?: string;
  tf?: string;
  from?: string;
  to?: string;
}): { symbol: string; tf: Timeframe; from: number; to: number } {
  const symbol = String(params.symbol ?? '')
    .trim()
    .toUpperCase();
  const tf = String(params.tf ?? '').trim();
  const from = parseDate(params.from, 'from');
  const to = parseDate(params.to, 'to');

  if (!symbol) throw new BadRequestException('symbol is required');
  if (!TIMEFRAMES.has(tf as Timeframe))
    throw new BadRequestException('Unsupported timeframe');
  if (from < 0 || to < 0)
    throw new BadRequestException('Dates must not be before Unix epoch');
  if (from >= to) throw new BadRequestException('from must be earlier than to');

  return { symbol, tf: tf as Timeframe, from, to };
}

function parseDate(value: string | undefined, name: string): number {
  if (!value) throw new BadRequestException(`${name} is required`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new BadRequestException(`${name} must be a valid date`);
  return timestamp;
}
