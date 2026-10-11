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
  totals: { calories: '123.456789', protein: null, fat: '3.45', carbs: '6.15' },
  issues: ['Неизвестен белок', 'mass-unavailable'],
};
export const day: NutritionDay = {
  date: '2026-01-01',
  fetchedAt: '2026-01-02T00:00:00Z',
  totals: entry.totals,
  knownTotals: { ...entry.totals, protein: '0' },
  officialTotals: {
    ...entry.totals,
    calories: '123',
    fat: '3.4499999999999997',
    carbs: '6.1499999999999995',
  },
  delta: { ...unknown, calories: '0.456789', fat: '3e-16', carbs: '5e-16' },
  meals: meals.map((kind) => ({
    kind,
    entries: kind === 'lunch' ? [entry] : [],
    totals: unknown,
    knownTotals: unknown,
    officialTotals: unknown,
    delta: unknown,
  })),
};
