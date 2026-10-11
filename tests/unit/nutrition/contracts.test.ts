import { expect, test } from 'vitest';
import {
  decimalStringSchema,
  nonnegativeDecimalSchema,
  diaryDateTimeSchema,
  nutritionDaySchema,
  nutritionTotalsSchema,
  mealPhotoSchema,
  toSafeMealPhotoView,
} from '@/contracts/nutrition';
import { normalizeDay } from '@/features/nutrition/domain';

test('transport decimals exclude JSON numbers, nonfinite values and unsupported syntax', () => {
  for (const value of [
    1,
    NaN,
    null,
    'NaN',
    'Infinity',
    '0xff',
    ' 1 ',
    '',
    '01',
  ])
    expect(decimalStringSchema.safeParse(value).success).toBe(false);
  for (const value of ['0', '1.1234567890123456789', '-5e-14', '1e+30'])
    expect(decimalStringSchema.safeParse(value).success).toBe(true);
  expect(nonnegativeDecimalSchema.safeParse('-0.001').success).toBe(false);
  expect(
    nutritionTotalsSchema.safeParse({
      calories: '0',
      protein: null,
      fat: '1',
      carbs: null,
    }).success,
  ).toBe(true);
});
test('diary time preserves wall clock and validates real date/time', () => {
  expect(diaryDateTimeSchema.parse('2024-02-29 23:59:59')).toBe(
    '2024-02-29 23:59:59',
  );
  for (const value of [
    '2025-02-29 12:00:00',
    '2026-10-10 24:00:00',
    '2026-10-10 00:60:00',
    '2026-10-10T12:00:00Z',
  ])
    expect(diaryDateTimeSchema.safeParse(value).success).toBe(false);
});
test('safe photo projection cannot expose storage, owner or upstream URL', () => {
  const photo = mealPhotoSchema.parse({
    id: 'photo',
    ownerId: 'owner',
    date: '2026-10-10',
    daytime: 'lunch',
    source: 'yazio',
    storageKey: 'private/key',
    contentHash: 'hash',
    sourceUrl: 'https://example.com/photo',
    observedAt: '2026-10-11T00:00:00Z',
  });
  expect(toSafeMealPhotoView(photo)).toEqual({
    id: 'photo',
    date: '2026-10-10',
    daytime: 'lunch',
    source: 'yazio',
    observedAt: '2026-10-11T00:00:00Z',
  });
  expect(
    mealPhotoSchema.parse({ ...photo, source: 'manual', sourceUrl: null })
      .sourceUrl,
  ).toBeNull();
});
test('day transport rejects duplicate meal buckets and keeps JSON-safe decimals', () => {
  const day = normalizeDay({
    date: '2026-10-10',
    fetchedAt: '2026-10-11T00:00:00Z',
    items: { products: [], recipe_portions: [], simple_products: [] },
    products: {},
    recipes: {},
    summary: { meals: {} },
  });
  expect(nutritionDaySchema.parse(JSON.parse(JSON.stringify(day)))).toEqual(
    day,
  );
  expect(
    nutritionDaySchema.safeParse({
      ...day,
      meals: [day.meals[0]!, day.meals[0]!, day.meals[2]!, day.meals[3]!],
    }).success,
  ).toBe(false);
});
