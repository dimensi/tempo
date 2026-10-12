import type { NutritionEntry } from '@/contracts/nutrition';
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
export function entryAmounts(entry: NutritionEntry) {
  return [
    [m.amount, displayValue(entry.amount, entry.baseUnit ?? '')],
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
  ];
}
