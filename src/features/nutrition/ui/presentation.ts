import type { NutritionEntry } from '@/contracts/nutrition';
import { diaryMessages as m } from './messages';

// Keep decimal strings exact: rounding can conceal summary residuals.
export function displayValue(value: string | null, unit = '') {
  return value === null
    ? m.unknown
    : `${value.replace('.', ',')}${unit ? ` ${unit}` : ''}`;
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
