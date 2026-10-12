import { describe, expect, it } from 'vitest';
import { hasNutritionMealContent } from '@/lib/nutrition-meal-content';
import { syntheticDay } from './reports/fixtures';

function emptyMeal() {
  const meal = syntheticDay('2026-10-11', 0).meals[0]!;
  meal.entries = [];
  for (const field of ['totals', 'knownTotals', 'officialTotals'] as const)
    meal[field] = {
      calories: null,
      protein: '0',
      fat: '-0.000e+99',
      carbs: '0e-999',
    };
  return meal;
}

describe('meal content', () => {
  it('hides canonical null/zero meals, including signed/exponent zeros', () => {
    expect(hasNutritionMealContent(emptyMeal())).toBe(false);
    expect(hasNutritionMealContent(undefined)).toBe(false);
  });
  it('retains photo-only and actual zero-calorie entries', () => {
    expect(hasNutritionMealContent(undefined, true)).toBe(true);
    const meal = emptyMeal();
    meal.entries = syntheticDay('2026-10-11', 1).meals[0]!.entries;
    meal.entries[0]!.totals.calories = '0';
    expect(hasNutritionMealContent(meal)).toBe(true);
  });
  it.each(['totals', 'knownTotals', 'officialTotals'] as const)(
    'retains any nonzero nutrient in %s without floating underflow',
    (field) => {
      const meal = emptyMeal();
      meal[field].protein = '1e-999';
      expect(hasNutritionMealContent(meal)).toBe(true);
      meal[field].protein = '0.0000000000000000001';
      expect(hasNutritionMealContent(meal)).toBe(true);
    },
  );
});
