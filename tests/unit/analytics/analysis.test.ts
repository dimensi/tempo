import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  analyzeNutrition,
  analyzeObservations,
  analyzeBody,
  compareMeans,
} from '@/features/analytics/analysis';
import { presetRange, previousRange } from '@/features/analytics/range';
import { normalizeDay } from '@/features/nutrition/domain';
import type { NutritionTotals } from '@/contracts/nutrition';
const range = { from: '2026-10-01', to: '2026-10-10' };
function day(
  date: string,
  values: Partial<NutritionTotals> = {},
  empty = false,
) {
  return normalizeDay({
    date,
    fetchedAt: '2026-10-14T00:00:00Z',
    products: {},
    recipes: {},
    summary: { meals: {} },
    items: {
      products: [],
      recipe_portions: [],
      simple_products: empty
        ? []
        : [
            {
              id: date,
              date: `${date} 12:00:00`,
              daytime: 'lunch',
              name: 'Synthetic',
              is_ai_generated: false,
              nutrients: {
                'energy.energy':
                  values.calories === undefined ? '2000' : values.calories,
                'nutrient.protein':
                  values.protein === undefined ? '100' : values.protein,
                'nutrient.fat': values.fat === undefined ? '50' : values.fat,
                'nutrient.carb':
                  values.carbs === undefined ? '150' : values.carbs,
              },
            },
          ],
    },
  });
}
describe('filled-day analytics', () => {
  it('distinguishes complete, partial, empty and missing without treating empty diaries as fasting', () => {
    const data = analyzeNutrition(range, [
      day(range.from),
      day('2026-10-02', { calories: null }),
      day('2026-10-03', {}, true),
    ]);
    expect(data).toMatchObject({
      completeDays: 1,
      partialDays: 1,
      emptyDays: 1,
      missingDays: 7,
      calorieDays: 1,
      calorieMean: '2000',
    });
    expect(data.days[2]).toMatchObject({
      quality: 'empty',
      totals: { calories: '0' },
    });
    expect(data.days[3]).toMatchObject({
      quality: 'missing',
      totals: { calories: null },
    });
  });
  it('uses a common macro cohort and energy weights 4/9/4', () => {
    const data = analyzeNutrition(range, [
      day(range.from, { protein: '100', fat: '100', carbs: '100' }),
      day('2026-10-02', { protein: null, fat: '200', carbs: '300' }),
    ]);
    expect(data.macros.days).toBe(1);
    expect(data.macros.averages).toEqual({
      protein: '100',
      fat: '100',
      carbs: '100',
    });
    expect(new Decimal(data.macros.energyShares.fat!).toNumber()).toBeCloseTo(
      (900 / 1700) * 100,
    );
    expect(
      new Decimal(data.macros.energyShares.protein!).toNumber(),
    ).toBeCloseTo((400 / 1700) * 100);
  });
  it('retains observed zero with food entries and does not manufacture a zero energy ratio', () => {
    const data = analyzeNutrition(range, [
      day(range.from, { calories: '0', protein: '0', fat: '0', carbs: '0' }),
    ]);
    expect(data.calorieMean).toBe('0');
    expect(data.completeDays).toBe(1);
    expect(data.macros.energyShares).toEqual({
      protein: null,
      fat: null,
      carbs: null,
    });
  });
});
it('requires 70 percent coverage on both sides and avoids division by zero', () => {
  expect(compareMeans('2000', '1800', 7, 7, 10)).toMatchObject({
    delta: '200',
  });
  expect(compareMeans('2000', '1800', 6, 7, 10)).toBeNull();
  expect(compareMeans('2000', '1800', 7, 6, 10)).toBeNull();
  expect(compareMeans('12', '0', 10, 10, 10)).toEqual({
    delta: '12',
    percent: null,
  });
  expect(compareMeans(null, '0', 10, 10, 10)).toBeNull();
});
it('supports 90 days and equal-length previous ranges across leap days', () => {
  expect(presetRange('quarter', '2026-10-14')).toEqual({
    from: '2026-07-17',
    to: '2026-10-14',
  });
  expect(previousRange({ from: '2024-03-01', to: '2024-03-07' })).toEqual({
    from: '2024-02-23',
    to: '2024-02-29',
  });
});
it('computes weight rate over actual elapsed observation days', () => {
  const data = analyzeObservations(range, [
    { id: 'a', date: '2026-10-02', value: '110.8', source: 'LOCAL' },
    { id: 'b', date: '2026-10-09', value: '108.6', source: 'YAZIO' },
  ]);
  expect(data.delta).toBe('-2.2');
  expect(data.weeklyRate).toBe('-2.2');
});
it('does not invent chronology or average conflicting same-day endpoint weights', () => {
  const data = analyzeObservations(range, [
    { id: 'a', date: range.from, value: '110', source: 'LOCAL' },
    { id: 'b', date: range.to, value: '108', source: 'LOCAL' },
    { id: 'c', date: range.to, value: '109', source: 'YAZIO' },
  ]);
  expect(data.observations).toHaveLength(3);
  expect(data.latest).toBeNull();
  expect(data.delta).toBeNull();
  expect(data.ambiguousEndpoints).toBe(true);
});
it('retains null imported observations and requires distinct dates for deltas', () => {
  const data = analyzeObservations(range, [
    { id: 'a', date: range.from, value: '110', source: 'LOCAL' },
    { id: 'b', date: range.from, value: '110', source: 'YAZIO' },
    { id: 'c', date: range.to, value: null, source: 'YAZIO' },
  ]);
  expect(data.delta).toBeNull();
  expect(data.weeklyRate).toBeNull();
  expect(data.latest?.value).toBe('110');
  expect(data.observations).toHaveLength(3);
});
it('combines source-labelled weight and strips owner/notes from browser data', () => {
  const data = analyzeBody(
    range,
    [
      {
        id: 'a',
        ownerId: 'private',
        sync: [],
        measuredAt: range.from,
        note: 'private note',
        values: [
          { metric: 'weight', value: '110', unit: 'kg' },
          { metric: 'waist', value: '100', unit: 'cm' },
        ],
      },
    ],
    {
      range,
      local: [],
      imported: [
        {
          measuredAt: range.to,
          rawValue: '108',
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
      ],
    },
  );
  expect(data.metrics.weight.delta).toBe('-2');
  expect(data.metrics.weight.observations.map((x) => x.source)).toEqual([
    'LOCAL',
    'YAZIO',
  ]);
  expect(data.metrics.waist.latest?.value).toBe('100');
  expect(JSON.stringify(data)).not.toContain('private');
});

it('projects provider float32 weights before comparisons but retains raw observations', () => {
  const raw = String(Math.fround(120.1));
  const data = analyzeBody(
    range,
    [
      {
        id: 'local',
        ownerId: 'owner',
        sync: [],
        measuredAt: range.to,
        note: null,
        values: [{ metric: 'weight', value: '120.1', unit: 'kg' }],
      },
    ],
    {
      range,
      local: [],
      imported: [
        {
          measuredAt: range.from,
          rawValue: '121.1',
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
        {
          measuredAt: range.to,
          rawValue: raw,
          unit: 'kg',
          unitStatus: 'OWNER_CONFIRMED',
          source: 'YAZIO',
        },
      ],
    },
  );
  expect(data.metrics.weight.delta).toBe('-1');
  expect(data.metrics.weight.ambiguousEndpoints).toBe(false);
  expect(data.metrics.weight.observations.at(-1)).toMatchObject({
    value: '120.1',
    rawValue: raw,
  });
});

it('retains absolute comparison deltas beyond the default significant-digit precision', () => {
  const result = compareMeans('1e100', '0.1', 10, 10, 10)!;
  expect(new Decimal(result.delta).eq('9'.repeat(100) + '.9')).toBe(true);
});
