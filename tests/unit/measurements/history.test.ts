import { it, expect } from 'vitest';
import { measurementChange } from '@/features/measurements/history';
import type { Measurement } from '@/contracts/measurements';
it('compares the prior available metric and rounds decimal changes', () => {
  const make = (
    id: string,
    measuredAt: string,
    value: string,
  ): Measurement => ({
    id,
    ownerId: 'owner',
    measuredAt,
    values: [{ metric: 'weight', value, unit: 'kg' }],
    note: null,
  });
  const old = make('a', '2026-10-01', '70.1');
  const current = make('b', '2026-10-11', '70.2');
  expect(measurementChange([old, current], current, 'weight')).toBe('+0.1');
  expect(measurementChange([old, current], old, 'weight')).toBeNull();
  expect(measurementChange([old, current], current, 'waist')).toBeNull();
});
