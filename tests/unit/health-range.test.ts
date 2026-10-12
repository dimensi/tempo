import { expect, it } from 'vitest';
import { healthRangeSchema, healthRangeDates } from '@/contracts/health';
it('uses UTC calendar dates across leap days and allows exactly 366 days', () => {
  expect(healthRangeDates({ from: '2024-02-28', to: '2024-03-01' })).toEqual([
    '2024-02-28',
    '2024-02-29',
    '2024-03-01',
  ]);
  expect(
    healthRangeDates({ from: '2024-01-01', to: '2024-12-31' }),
  ).toHaveLength(366);
  expect(
    healthRangeSchema.safeParse({ from: '2024-01-01', to: '2025-01-01' })
      .success,
  ).toBe(false);
  expect(
    healthRangeSchema.safeParse({
      from: '2026-10-10',
      to: '2026-10-12',
      ownerId: 'foreign',
    }).success,
  ).toBe(false);
});
