import Decimal from 'decimal.js';
import type { NutritionEntry, NutritionTotals } from '@/contracts/nutrition';
import { diaryMessages as m } from './messages';

import { formatDecimal } from '@/lib/number-display';

export function displayValue(
  value: string | null,
  unit = '',
  kind: 'value' | 'delta' = 'value',
) {
  const formatted = formatDecimal(value, { kind });
  return formatted === null
    ? m.unknown
    : `${formatted}${unit ? ` ${unit}` : ''}`;
}
export function displayIssue(issue: string): string {
  return m.massIssues[issue as keyof typeof m.massIssues] ?? issue;
}
/** Hide only quantities which repeat an authoritative mass or volume. */
export function entryAmounts(entry: NutritionEntry) {
  const unit =
    entry.baseUnit === 'g'
      ? 'г'
      : entry.baseUnit === 'ml'
        ? 'мл'
        : (entry.baseUnit ?? '');
  const repeatedAmount =
    entry.amount !== null &&
    ((entry.baseUnit === 'g' &&
      entry.massG !== null &&
      new Decimal(entry.amount).eq(entry.massG)) ||
      (entry.baseUnit === 'ml' &&
        entry.volumeMl !== null &&
        new Decimal(entry.amount).eq(entry.volumeMl)));
  return [
    ...(repeatedAmount ? [] : [[m.amount, displayValue(entry.amount, unit)]]),
    [
      m.serving,
      entry.serving === null
        ? m.unknown
        : `${entry.serving}${entry.servingQuantity === null ? '' : ` × ${displayValue(entry.servingQuantity)}`}`,
    ],
    [m.consumed, displayValue(entry.consumedPortions)],
    [m.recipe, displayValue(entry.recipePortions)],
    [m.mass, displayValue(entry.massG, 'г')],
    [m.volume, displayValue(entry.volumeMl, 'мл')],
    ...(entry.ingredientMassEstimateG === null
      ? []
      : [[m.estimate, displayValue(entry.ingredientMassEstimateG, 'г')]]),
  ].filter(([, value]) => value !== m.unknown);
}

export function entryQuantity(entry: NutritionEntry) {
  const amounts = entryAmounts(entry);
  return amounts
    .filter(
      ([label]) =>
        label === m.amount ||
        label === m.mass ||
        label === m.volume ||
        label === m.serving ||
        label === m.consumed,
    )
    .map(([label, value]) =>
      label === m.consumed ? `${m.consumed}: ${value}` : value,
    )
    .join(' · ');
}

// Display significance only; normalization and stored decimal values remain unchanged.
export function noticeableDifferences(delta: NutritionTotals) {
  return (Object.keys(m.nutrients) as (keyof NutritionTotals)[]).filter(
    (key) => {
      const value = delta[key];
      return value !== null && new Decimal(value).abs().gte('0.005');
    },
  );
}
