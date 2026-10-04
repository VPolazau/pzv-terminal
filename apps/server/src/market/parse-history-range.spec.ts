import { BadRequestException } from '@nestjs/common';
import { parseHistoryRange } from './parse-history-range';

describe('parseHistoryRange', () => {
  it('parses ISO dates and normalizes the symbol', () => {
    expect(
      parseHistoryRange({
        symbol: ' btcusdt ',
        tf: '1h',
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
      }),
    ).toMatchObject({ symbol: 'BTCUSDT', tf: '1h' });
  });

  it.each([
    {},
    { symbol: 'BTCUSDT', tf: '1h', from: 'not-a-date', to: '2025-01-02' },
    { symbol: 'BTCUSDT', tf: '5m', from: '2025-01-01', to: '2025-01-02' },
    { symbol: 'BTCUSDT', tf: '1h', from: '2025-01-02', to: '2025-01-01' },
  ])('rejects invalid history parameters: %j', (params) => {
    expect(() => parseHistoryRange(params)).toThrow(BadRequestException);
  });
});
