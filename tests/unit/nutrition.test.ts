import { expect, test } from 'vitest';
import { macroEnergyShares } from '@/lib/macro-energy';

test('computes macro energy from protein, fat and carbohydrates without inventing incomplete data', () => {
  const totals = { calories: '123', protein: '9', fat: '4', carbs: '9' };

  expect(macroEnergyShares(totals)?.map((share) => share.percent)).toEqual([
    100 / 3,
    100 / 3,
    100 / 3,
  ]);
  expect(macroEnergyShares({ ...totals, calories: null })).toEqual(
    macroEnergyShares(totals),
  );
  expect(macroEnergyShares({ ...totals, fat: null })).toBeNull();
});
