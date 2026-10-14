import type { NutritionAnalysis } from '@/contracts/analytics';
import { toChartNumber } from '@/lib/number-display';

export function nutritionChart(days: NutritionAnalysis['days']) {
  return days.map((day) => ({
    date: day.date,
    complete:
      day.quality === 'complete' ? toChartNumber(day.totals.calories) : null,
    partial:
      day.quality === 'partial'
        ? toChartNumber(day.totals.calories ?? day.knownTotals.calories)
        : null,
  }));
}
