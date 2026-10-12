import Decimal from 'decimal.js';
import type { NutritionTotals } from '@/contracts/nutrition';

const EnergyDecimal = Decimal.clone({ precision: 40 });
export const macroKeys = ['protein', 'fat', 'carbs'] as const;
/** Normalize energy shares before conversion to chart numbers, including huge decimals. */
export function macroEnergyShares(totals: NutritionTotals | null) {
  if (!totals || macroKeys.some((key) => totals[key] === null)) return null;
  const energies = macroKeys.map((key) =>
    new EnergyDecimal(totals[key]!).mul(key === 'fat' ? 9 : 4),
  );
  if (energies.some((value) => !value.isFinite() || value.lt(0))) return null;
  const total = energies.reduce(
    (sum, value) => sum.plus(value),
    new EnergyDecimal(0),
  );
  return energies.map((energy, index) => ({
    key: macroKeys[index]!,
    percent:
      total.isZero() || energy.isZero()
        ? 0
        : energy.div(total).mul(100).toNumber(),
  }));
}
