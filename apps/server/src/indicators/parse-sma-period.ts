import { BadRequestException } from '@nestjs/common';

export function parseSmaPeriod(
  value: string,
  name: string,
  min: number,
  max: number,
): number {
  const period =
    typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(period) || period < min || period > max) {
    throw new BadRequestException(
      `${name} must be an integer between ${min} and ${max}`,
    );
  }
  return period;
}
