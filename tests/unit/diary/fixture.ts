import {
  meals,
  type NutritionDay,
  type NutritionEntry,
} from '@/contracts/nutrition';
const unknown = { calories: null, protein: null, fat: null, carbs: null };
export const entry: NutritionEntry = {
  id: 'synthetic-entry',
  kind: 'ai',
  name: 'Синтетический обед',
  meal: 'lunch',
  diaryDateTime: '2026-01-01 12:34:56',
  addedAt: null,
  consumedAt: null,
  editedAt: null,
  sourceId: null,
  amount: '1.5',
  baseUnit: null,
  serving: null,
  servingQuantity: null,
  consumedPortions: '1.5',
  recipePortions: null,
  massG: null,
  volumeMl: '250',
  ingredientMassEstimateG: null,
  totals: { calories: '123.456789', protein: null, fat: '0', carbs: '12' },
  issues: ['Неизвестен белок'],
};
export const day: NutritionDay = {
  date: '2026-01-01',
  fetchedAt: '2026-01-02T00:00:00Z',
  totals: entry.totals,
  knownTotals: { ...entry.totals, protein: '0' },
  officialTotals: { ...entry.totals, calories: '123' },
  delta: { ...unknown, calories: '0.456789' },
  meals: meals.map((kind) => ({
    kind,
    entries: kind === 'lunch' ? [entry] : [],
    totals: unknown,
    knownTotals: unknown,
    officialTotals: unknown,
    delta: unknown,
  })),
};
