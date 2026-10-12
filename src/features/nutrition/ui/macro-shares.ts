import Decimal from 'decimal.js';
import type { NutritionTotals } from '@/contracts/nutrition';
const factors = { protein: 4, fat: 9, carbs: 4 } as const;
export function macroCalorieShares(totals: NutritionTotals) {
  const keys = ['protein', 'fat', 'carbs'] as const;
  if (keys.some((key) => totals[key] === null)) return null;
  const energy = keys.map((key) =>
    new Decimal(totals[key]!).times(factors[key]),
  );
  if (energy.some((value) => !value.isFinite() || value.lt(0))) return null;
  const sum = energy.reduce(
    (total, value) => total.plus(value),
    new Decimal(0),
  );
  if (sum.isZero()) return null;
  return keys.map((key, index) => ({
    key,
    percent: energy[index]!.isZero()
      ? 0
      : energy[index]!.div(sum).times(100).toNumber(),
  }));
}
