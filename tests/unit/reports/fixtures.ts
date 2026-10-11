import {
  meals,
  type NutritionDay,
  type NutritionTotals,
} from '@/contracts/nutrition';
export const totals: NutritionTotals = {
  calories: '0.1',
  protein: '12.5212',
  fat: null,
  carbs: '0.7636',
};
export function syntheticDay(date = '2026-10-10', entries = 1): NutritionDay {
  return {
    date,
    fetchedAt: '2026-10-11T00:00:00Z',
    totals,
    knownTotals: { ...totals, fat: '13.6528' },
    officialTotals: { ...totals, calories: '180.32' },
    delta: { calories: '-180.22', protein: '0', fat: null, carbs: '0' },
    meals: meals.map((kind, index) => ({
      kind,
      totals,
      knownTotals: totals,
      officialTotals: totals,
      delta: totals,
      entries: index
        ? []
        : Array.from({ length: entries }, (_, i) => ({
            id: `synthetic-${i}`,
            kind: 'product' as const,
            name: `Яйцо · запись ${i + 1}`,
            meal: kind,
            diaryDateTime: `${date} 10:35:44`,
            addedAt: null,
            consumedAt: null,
            editedAt: null,
            sourceId: null,
            amount: '92',
            baseUnit: 'g',
            serving: 'egg.large',
            servingQuantity: '2',
            consumedPortions: null,
            recipePortions: null,
            massG: '92',
            volumeMl: null,
            ingredientMassEstimateG: null,
            totals: { ...totals, calories: '180.32' },
            issues: ['fat unavailable'],
          })),
    })),
  };
}
