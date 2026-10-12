import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  normalizeHealthSummary,
  normalizeYazioWeight,
  deduplicateYazioWeights,
} from '@/server/yazio/health-normalize';
import { importedWeightSchema } from '@/contracts/yazio-health';
const weight = {
  id: 'A1111111-1111-4111-8111-111111111111',
  date: '2026-10-01',
  value: 80.125,
  external_id: null,
  source: 'synthetic',
  gateway: null,
};
test('unknown steps differ from explicit zero and invalid counts fail', () => {
  expect(normalizeHealthSummary({}, '2026-10-12').dailySteps.steps).toBeNull();
  expect(
    normalizeHealthSummary({ steps: null }, '2026-10-12').dailySteps.steps,
  ).toBeNull();
  expect(
    normalizeHealthSummary({ steps: 0 }, '2026-10-12').dailySteps.steps,
  ).toBe(0);
  for (const steps of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '100'])
    expect(() => normalizeHealthSummary({ steps }, '2026-10-12')).toThrow();
});
test('weight retains its own identity/date and unproven preference is metadata', () => {
  const record = normalizeYazioWeight(weight, 'lb')!;
  expect(record).toMatchObject({
    externalId: weight.id.toLowerCase(),
    measuredDate: weight.date,
    rawValue: '80.125',
    unit: null,
    unitContext: 'lb',
  });
  expect(importedWeightSchema.parse(record)).toEqual(record);
  expect(deduplicateYazioWeights([record, record])).toHaveLength(1);
  expect(normalizeYazioWeight(null, null)).toBeNull();
  expect(
    normalizeYazioWeight({ ...weight, value: null }, null)?.rawValue,
  ).toBeNull();
});
test('ambiguous timestamps retain provider value without fabricated calendar date', () => {
  for (const date of [
    '2026-10-01 10:00:00',
    '2026-10-01T23:00:00-04:00',
    '2026-02-30',
  ]) {
    const record = normalizeYazioWeight({ ...weight, date }, null)!;
    expect(record.providerDate).toBe(date);
    expect(record.measuredDate).toBeNull();
  }
});
