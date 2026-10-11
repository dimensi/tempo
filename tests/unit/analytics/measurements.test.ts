import { it, expect } from 'vitest';
import { measurementsInRange } from '@/features/analytics/measurements';
import type { Measurement } from '@/contracts/measurements';
it('filters inclusive dates and preserves decimal measurements without converting units', () => {
  const record = (id: string, measuredAt: string): Measurement => ({
    id,
    ownerId: 'synthetic',
    measuredAt,
    note: null,
    values: [{ metric: 'weight', value: '80.125', unit: 'kg' }],
  });
  const data = measurementsInRange({ from: '2026-10-01', to: '2026-10-03' }, [
    record('end', '2026-10-03'),
    record('outside', '2026-09-30'),
    record('start', '2026-10-01'),
  ]);
  expect(data.map((item) => item.id)).toEqual(['start', 'end']);
  expect(data[0]!.values[0]!.value).toBe('80.125');
});
