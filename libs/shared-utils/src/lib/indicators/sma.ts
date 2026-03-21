export function sma(values: number[], period: number): number | null {
  if (!Number.isFinite(period) || period <= 0) return null;
  if (values.length < period) return null;

  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}
