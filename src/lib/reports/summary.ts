import Decimal from 'decimal.js';
import type { NutritionDay, NutritionTotals } from '@/contracts/nutrition';
const Exact = Decimal.clone({ precision: 320, toExpNeg: -110, toExpPos: 110 });
const keys = ['calories', 'protein', 'fat', 'carbs'] as const;
export function summarizeDays(days: NutritionDay[], expectedDays: number) {
  const totals = {} as NutritionTotals;
  const knownTotals = {} as NutritionTotals;
  for (const key of keys) {
    let total = new Exact(0),
      known = new Exact(0);
    let hasKnown = false;
    let complete = days.length === expectedDays;
    for (const day of days) {
      if (day.totals[key] === null) complete = false;
      else total = total.plus(day.totals[key]!);
      if (day.knownTotals[key] !== null) {
        hasKnown = true;
        known = known.plus(day.knownTotals[key]!);
      }
    }
    totals[key] = complete ? total.toString() : null;
    knownTotals[key] = hasKnown ? known.toString() : null;
  }
  return { totals, knownTotals, availableDays: days.length, expectedDays };
}
