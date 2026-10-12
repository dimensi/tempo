import 'server-only';
import Decimal from 'decimal.js';
import {
  meals,
  type NutritionDay,
  type NutritionTotals,
} from '@/contracts/nutrition';

const Exact = Decimal.clone({ precision: 320 });
const parse = (value: string | null): Decimal | null => {
  if (value === null) return null;
  try {
    const number = new Exact(value);
    return number.isFinite() && number.greaterThanOrEqualTo(0) ? number : null;
  } catch {
    return null;
  }
};

// Allocate integer display units; ties retain the documented nutrient/meal order.
function allocate(weights: Decimal[], units: number): number[] | null {
  const total = weights.reduce((sum, value) => sum.plus(value), new Exact(0));
  if (total.isZero()) return null;
  const quotas = weights.map((weight) => weight.times(units).dividedBy(total));
  const values = quotas.map((quota) => quota.floor().toNumber());
  const order = quotas
    .map((quota, index) => ({ index, remainder: quota.minus(values[index]!) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  const remaining = units - values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index++)
    values[order[index]!.index]!++;
  return values;
}

export function macroShares(totals: NutritionTotals) {
  const amounts = [totals.protein, totals.fat, totals.carbs].map(parse);
  if (amounts.some((value) => value === null)) return null;
  const weights = amounts.map((value, index) =>
    value!.times([4, 9, 4][index]!),
  );
  const tenths = allocate(weights, 1000);
  if (tenths === null) return null;
  return {
    energy: weights
      .reduce((sum, value) => sum.plus(value), new Exact(0))
      .toString(),
    tenths,
    widths: weights.map((weight) =>
      weight
        .times(100)
        .dividedBy(weights.reduce((sum, item) => sum.plus(item), new Exact(0)))
        .toString(),
    ),
  };
}

export function mealShares(day: NutritionDay) {
  const values = meals.map((kind) =>
    parse(
      day.meals.find((meal) => meal.kind === kind)?.totals.calories ?? null,
    ),
  );
  const weights = values.map((value) => value ?? new Exact(0));
  const percentages = allocate(weights, 100);
  const total = weights.reduce((sum, value) => sum.plus(value), new Exact(0));
  const dayCalories = parse(day.totals.calories);
  return {
    percentages:
      percentages?.map((value, index) =>
        values[index] === null ? null : value,
      ) ?? null,
    widths:
      percentages === null
        ? null
        : weights.map((weight, index) =>
            values[index] === null
              ? null
              : weight.times(100).dividedBy(total).toString(),
          ),
    recordedOnly:
      values.some((value) => value === null) ||
      dayCalories === null ||
      !dayCalories.equals(total),
  };
}
