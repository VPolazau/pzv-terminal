export function smaAt(
  values: number[],
  period: number,
  index: number,
): number | null {
  if (!Number.isFinite(period) || period <= 0) return null;
  if (index < period - 1) return null;
  if (index >= values.length) return null;

  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    sum += values[i];
  }
  return sum / period;
}
