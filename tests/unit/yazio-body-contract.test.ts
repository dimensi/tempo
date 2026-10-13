import { expect, it } from 'vitest';
import {
  bodySummarySchema,
  bodyRangeSchema,
  bodyEntrySchema,
  bodyMetricKeys,
} from '@/contracts/yazio-body';
it('accepts APK sparse nullable groups while rejecting error and unexpected envelopes', () => {
  expect(bodySummarySchema.parse({ weight: null })).toEqual({ weight: null });
  expect(bodySummarySchema.parse({})).toEqual({});
  expect(
    bodySummarySchema.safeParse({ error: 'upstream failure' }).success,
  ).toBe(false);
  expect(bodySummarySchema.safeParse({ unexpected: [] }).success).toBe(false);
  expect(
    bodySummarySchema.safeParse({
      weight: [{ id: 'missing', value: 80, date: '2026-10-13' }],
    }).success,
  ).toBe(false);
});
it('keeps explicit kg/cm field mapping and actual wall date-time without timezone inference', () => {
  expect(Object.values(bodyMetricKeys)).toEqual([
    'weight',
    'circumference.waist',
    'circumference.hip',
    'circumference.chest',
    'circumference.thigh',
    'circumference.arm',
  ]);
  const wire = {
    id: '90000000-0000-4000-8000-000000000001',
    value: 80.12345,
    date: '2026-10-12 23:59:01',
  };
  expect(bodyEntrySchema.parse(wire)).toEqual(wire);
  expect(
    bodyRangeSchema.parse([{ date: wire.date, value: wire.value }]),
  ).toHaveLength(1);
  expect(
    bodyEntrySchema.safeParse({ ...wire, date: '2026-02-31 00:00:00' }).success,
  ).toBe(false);
});
