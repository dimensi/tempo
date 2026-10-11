import { describe, it, expect } from 'vitest';
import { measurementInputSchema } from '@/contracts/measurements';
const valid = {
  measuredAt: '2026-10-11',
  values: [{ metric: 'weight', value: '70.123', unit: 'kg' }],
  note: null,
};
describe('manual measurements validation', () => {
  it('accepts partial metrics and preserves decimal precision', () =>
    expect(measurementInputSchema.parse(valid)).toEqual(valid));
  it.each(['0', '-1', 'NaN', '1e3', '1.2345', '70,2'])(
    'rejects invalid decimal %s',
    (value) =>
      expect(
        measurementInputSchema.safeParse({
          ...valid,
          values: [{ ...valid.values[0], value }],
        }).success,
      ).toBe(false),
  );
  it('rejects duplicate metrics, wrong units and impossible dates', () => {
    expect(
      measurementInputSchema.safeParse({
        ...valid,
        values: [...valid.values, ...valid.values],
      }).success,
    ).toBe(false);
    expect(
      measurementInputSchema.safeParse({
        ...valid,
        values: [{ ...valid.values[0], unit: 'cm' }],
      }).success,
    ).toBe(false);
    expect(
      measurementInputSchema.safeParse({ ...valid, measuredAt: '2026-02-30' })
        .success,
    ).toBe(false);
  });
  it('rejects owner injection and empty records', () => {
    expect(
      measurementInputSchema.safeParse({ ...valid, ownerId: 'other' }).success,
    ).toBe(false);
    expect(
      measurementInputSchema.safeParse({ ...valid, values: [] }).success,
    ).toBe(false);
  });
});
