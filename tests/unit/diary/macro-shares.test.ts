import { expect, it } from 'vitest';
import { macroCalorieShares } from '@/features/nutrition/ui/macro-shares';
const totals = { calories: '200', protein: '10', fat: '5', carbs: '20' };
it('weights macro grams by 4/9/4 and uses macro energy rather than provider calories', () => {
  const shares = macroCalorieShares(totals)!;
  expect(shares.map((share) => share.key)).toEqual(['protein', 'fat', 'carbs']);
  expect(shares[0]!.percent).toBeCloseTo((40 / 165) * 100);
  expect(shares[1]!.percent).toBeCloseTo((45 / 165) * 100);
  expect(shares[2]!.percent).toBeCloseTo((80 / 165) * 100);
  expect(macroCalorieShares({ ...totals, calories: null })).toEqual(shares);
});
it('hides missing and zero energy rather than inventing a whole pie', () => {
  expect(macroCalorieShares({ ...totals, protein: null })).toBeNull();
  expect(
    macroCalorieShares({ ...totals, protein: '0', fat: '0.000', carbs: '-0' }),
  ).toBeNull();
  expect(macroCalorieShares({ ...totals, protein: '-1' })).toBeNull();
});
it('preserves real zero shares and decimal values smaller than Number can represent', () => {
  expect(macroCalorieShares({ ...totals, protein: '-0' })![0]!.percent).toBe(0);
  expect(
    macroCalorieShares({
      ...totals,
      protein: '1e-999',
      fat: '1e-999',
      carbs: '1e-999',
    })![1]!.percent,
  ).toBeCloseTo((9 / 17) * 100);
});
