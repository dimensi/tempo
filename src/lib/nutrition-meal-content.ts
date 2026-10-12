import type { NutritionMeal } from '@/contracts/nutrition';

// Inspect the coefficient directly: Number('1e-999') would lose real content.
const zeroDecimal = /^-?0(?:\.0+)?(?:e[+-]?\d+)?$/i;

export function hasNutritionMealContent(
  meal: NutritionMeal | undefined,
  hasPhoto = false,
): boolean {
  if (hasPhoto || (meal?.entries.length ?? 0) > 0) return true;
  if (!meal) return false;
  return [meal.totals, meal.knownTotals, meal.officialTotals].some((totals) =>
    Object.values(totals).some(
      (value) => value !== null && !zeroDecimal.test(value),
    ),
  );
}
