import Decimal from 'decimal.js';
import type { NutritionDay, NutritionTotals } from '@/contracts/nutrition';
import type {
  AnalyticsRange,
  AnalyticsSummary,
  Nutrient,
} from '@/contracts/analytics';
import { rangeDates } from './range';
export const nutrients: Nutrient[] = ['calories', 'protein', 'fat', 'carbs'];
const unknown: NutritionTotals = {
  calories: null,
  protein: null,
  fat: null,
  carbs: null,
};
// Choose precision from the occupied decimal positions so addition never rounds.
function exactSum(values: string[]): string {
  const decimals = values.map((value) => new Decimal(value));
  const highest = Math.max(...decimals.map((value) => value.e));
  const lowest = Math.min(...decimals.map((value) => value.e - value.sd() + 1));
  const Exact = Decimal.clone({
    precision: Math.max(
      40,
      highest - lowest + String(values.length).length + 2,
    ),
  });
  return values
    .reduce((sum, value) => sum.plus(value), new Exact(0))
    .toString();
}
export function summarizeNutrition(
  range: AnalyticsRange,
  input: NutritionDay[],
): AnalyticsSummary {
  const dates = rangeDates(range);
  const byDate = new Map<string, NutritionDay>();
  for (const day of input) {
    if (day.date < range.from || day.date > range.to) continue;
    if (byDate.has(day.date)) throw new Error('Duplicate nutrition day');
    byDate.set(day.date, day);
  }
  const days = dates.map((date) => {
    const day = byDate.get(date);
    return {
      date,
      recorded: !!day,
      totals: day?.totals ?? { ...unknown },
      knownTotals: day?.knownTotals ?? { ...unknown },
    };
  });
  const summaries = {} as AnalyticsSummary['nutrients'];
  for (const nutrient of nutrients) {
    const values = days.flatMap((day) =>
      day.totals[nutrient] === null ? [] : [day.totals[nutrient]!],
    );
    const total = values.length ? exactSum(values) : null;
    const Mean = Decimal.clone({ precision: 40 });
    summaries[nutrient] = {
      total,
      mean:
        total === null ? null : new Mean(total).div(values.length).toString(),
      confirmedDays: values.length,
      partialDays: days.filter(
        (day) =>
          day.recorded &&
          day.totals[nutrient] === null &&
          day.knownTotals[nutrient] !== null,
      ).length,
    };
  }
  return {
    range,
    calendarDays: dates.length,
    recordedDays: byDate.size,
    nutrients: summaries,
    days,
  };
}
