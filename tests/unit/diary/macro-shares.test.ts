import { expect, it } from 'vitest';
import { macroEnergyShares } from '@/lib/macro-energy';
const totals = { calories: '200', protein: '10', fat: '5', carbs: '20' };
it('weights macro grams by 4/9/4 and uses macro energy rather than provider calories', () => {
  const shares = macroEnergyShares(totals)!;
  expect(shares.map((share) => share.key)).toEqual(['protein', 'fat', 'carbs']);
  expect(shares[0]!.percent).toBeCloseTo((40 / 165) * 100);
  expect(shares[1]!.percent).toBeCloseTo((45 / 165) * 100);
  expect(shares[2]!.percent).toBeCloseTo((80 / 165) * 100);
  expect(macroEnergyShares({ ...totals, calories: null })).toEqual(shares);
});
it('distinguishes missing from zero energy without inventing segments', () => {
  expect(macroEnergyShares({ ...totals, protein: null })).toBeNull();
  expect(
    macroEnergyShares({
      ...totals,
      protein: '0',
      fat: '0.000',
      carbs: '-0',
    })?.map((share) => share.percent),
  ).toEqual([0, 0, 0]);
  expect(macroEnergyShares({ ...totals, protein: '-1' })).toBeNull();
});
it('preserves real zero shares and decimal values smaller than Number can represent', () => {
  expect(macroEnergyShares({ ...totals, protein: '-0' })![0]!.percent).toBe(0);
  expect(
    macroEnergyShares({
      ...totals,
      protein: '1e-999',
      fat: '1e-999',
      carbs: '1e-999',
    })![1]!.percent,
  ).toBeCloseTo((9 / 17) * 100);
});
