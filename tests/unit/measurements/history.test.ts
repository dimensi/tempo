import { it, expect } from 'vitest';
import {
  measurementChange,
  weightTrendChart,
} from '@/features/measurements/history';
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
    sync: [],
  });
  const old = make('a', '2026-10-01', '70.1');
  const current = make('b', '2026-10-11', '70.2');
  expect(measurementChange([old, current], current, 'weight')).toBe('+0.1');
  expect(measurementChange([old, current], old, 'weight')).toBeNull();
  expect(measurementChange([old, current], current, 'waist')).toBeNull();
});
it('combined kg chart preserves all same-day observations and source differences without averaging', () => {
  expect(
    weightTrendChart({
      range: { from: '2026-10-01', to: '2026-10-03' },
      local: [
        {
          measuredAt: '2025-10-01',
          value: '68.5',
          unit: 'kg',
          source: 'LOCAL',
        },
        {
          measuredAt: '2026-10-02',
          value: '72.125',
          unit: 'kg',
          source: 'LOCAL',
        },
        {
          measuredAt: '2026-10-02',
          value: '72.5',
          unit: 'kg',
          source: 'LOCAL',
        },
      ],
      imported: [
        {
          measuredAt: '2026-10-01',
          rawValue: '0',
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
        {
          measuredAt: '2026-10-02',
          rawValue: '73.125',
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
        {
          measuredAt: '2026-10-03',
          rawValue: null,
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
      ],
    }),
  ).toEqual([
    { date: '2025-10-01', local: 68.5, yazio: null },
    { date: '2026-10-01', local: null, yazio: 0 },
    { date: '2026-10-02', local: 72.125, yazio: 73.125 },
    { date: '2026-10-02', local: 72.5, yazio: null },
    { date: '2026-10-03', local: null, yazio: null },
  ]);
});

it('groups only identical warnings for presentation, retaining IDs/times and distinct-value stable keys', async () => {
  const { groupPrecisionIssues } =
    await import('@/features/measurements/history');
  const first = {
    id: 'a1111111-1111-4111-8111-111111111111',
    metric: 'weight' as const,
    date: '2026-10-07',
    dateTime: '2026-10-07 10:55:11',
    value: '80.12345',
  };
  const second = {
    ...first,
    id: 'b1111111-1111-4111-8111-111111111111',
    dateTime: '2026-10-07 10:55:43',
  };
  const different = {
    ...first,
    id: 'c1111111-1111-4111-8111-111111111111',
    value: '80.12346',
  };
  const issues = [second, first, different],
    copy = structuredClone(issues);
  const groups = groupPrecisionIssues(issues);
  expect(groups).toHaveLength(2);
  expect(groups[0]?.observations).toEqual([first, second]);
  expect(groups[0]?.key).not.toBe(groups[1]?.key);
  expect(groupPrecisionIssues([...issues].reverse())).toEqual(groups);
  expect(issues).toEqual(copy);
});
