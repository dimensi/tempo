import { describe, it, expect } from 'vitest';
import { summarizeNutrition } from '@/features/analytics/summary';
import { presetRange } from '@/features/analytics/range';
import { analyticsRangeSchema } from '@/contracts/analytics';
import type { NutritionDay, NutritionTotals } from '@/contracts/nutrition';
const range = { from: '2026-10-01', to: '2026-10-03' };
function day(
  date: string,
  totals: NutritionTotals,
  knownTotals = totals,
): NutritionDay {
  return {
    date,
    fetchedAt: '2026-10-04T00:00:00Z',
    meals: [],
    totals,
    knownTotals,
    officialTotals: totals,
    delta: totals,
  };
}
const totals = (
  calories: string | null,
  protein: string | null = '1',
): NutritionTotals => ({ calories, protein, fat: '2', carbs: '3' });
describe('nutrition coverage and decimal summaries', () => {
  it('keeps missing days null and excludes known partial calories from mean', () => {
    const result = summarizeNutrition(range, [
      day(range.from, totals('100.1')),
      day(range.to, totals(null, '3'), totals('50.5', '3')),
    ]);
    expect(result.recordedDays).toBe(2);
    expect(result.days[1]).toMatchObject({
      recorded: false,
      totals: { calories: null },
    });
    expect(result.nutrients.calories).toEqual({
      total: '100.1',
      mean: '100.1',
      confirmedDays: 1,
      partialDays: 1,
    });
    expect(result.nutrients.protein).toMatchObject({
      total: '4',
      mean: '2',
      confirmedDays: 2,
    });
  });
  it('counts confirmed zero and sums exact decimal positions beyond default precision', () => {
    const result = summarizeNutrition(range, [
      day(range.from, totals('100000000000000000000.1')),
      day('2026-10-02', totals('0.2')),
      day(range.to, totals('0')),
    ]);
    expect(result.nutrients.calories.total).toBe('100000000000000000000.3');
    expect(result.nutrients.calories.confirmedDays).toBe(3);
  });
  it('empty input has no manufactured zero averages', () => {
    expect(summarizeNutrition(range, []).nutrients.calories).toEqual({
      total: null,
      mean: null,
      confirmedDays: 0,
      partialDays: 0,
    });
  });
  it('rejects ambiguous duplicate days and excludes outside dates', () => {
    const record = day(range.from, totals('1'));
    expect(() => summarizeNutrition(range, [record, record])).toThrow(
      'Duplicate',
    );
    expect(
      summarizeNutrition(range, [day('2026-09-30', totals('1'))]).recordedDays,
    ).toBe(0);
  });
  it('uses inclusive rolling ranges across months and bounds custom ranges', () => {
    expect(presetRange('week', '2026-03-02')).toEqual({
      from: '2026-02-24',
      to: '2026-03-02',
    });
    expect(presetRange('month', '2026-03-02')).toEqual({
      from: '2026-02-01',
      to: '2026-03-02',
    });
    expect(
      analyticsRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-02' })
        .success,
    ).toBe(false);
    expect(
      analyticsRangeSchema.safeParse({ from: '2026-10-03', to: '2026-10-01' })
        .success,
    ).toBe(false);
    expect(
      analyticsRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' })
        .success,
    ).toBe(false);
  });
});
