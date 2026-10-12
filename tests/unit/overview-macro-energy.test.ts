import { expect, test } from 'vitest';
import { macroEnergyShares } from '@/lib/macro-energy';
const totals = { calories: '123', protein: '9', fat: '4', carbs: '9' };
test('energy shares use 4/9/4 independently of declared calories', () => {
  expect(macroEnergyShares(totals)?.map((share) => share.percent)).toEqual([
    100 / 3,
    100 / 3,
    100 / 3,
  ]);
  expect(macroEnergyShares({ ...totals, calories: null })).toEqual(
    macroEnergyShares(totals),
  );
});
test('unknown macro stays unknown and all zero has no invented energy', () => {
  expect(macroEnergyShares({ ...totals, fat: null })).toBeNull();
  expect(macroEnergyShares(null)).toBeNull();
  expect(
    macroEnergyShares({ ...totals, protein: '0', fat: '0', carbs: '0' })?.map(
      (share) => share.percent,
    ),
  ).toEqual([0, 0, 0]);
});
test('normalizes very large and very small decimals before binary conversion', () => {
  for (const exponent of ['400', '-400']) {
    const shares = macroEnergyShares({
      ...totals,
      protein: `9e${exponent}`,
      fat: `4e${exponent}`,
      carbs: `9e${exponent}`,
    });
    expect(shares?.map((share) => share.percent)).toEqual([
      100 / 3,
      100 / 3,
      100 / 3,
    ]);
  }
});
