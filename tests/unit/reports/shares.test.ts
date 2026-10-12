import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { macroShares, mealShares } from '@/server/pdf/shares';
import { syntheticDay } from './fixtures';

it('allocates 4/9/4 energy to exactly 100.0%, independently of diary calories', () => {
  const totals = {
    calories: '1460.5',
    protein: '98.75',
    fat: '76.55',
    carbs: '83.7',
  };
  expect(macroShares(totals)).toMatchObject({
    energy: '1418.75',
    tenths: [278, 486, 236],
  });
  expect(macroShares({ ...totals, calories: null })).toEqual(
    macroShares(totals),
  );
  expect(totals.calories).toBe('1460.5');
  expect(macroShares(totals)!.widths.map(Number)).toEqual(
    [98.75 * 4, 76.55 * 9, 83.7 * 4].map((energy) =>
      expect.closeTo((energy / 1418.75) * 100, 10),
    ),
  );
  expect(Number(macroShares(totals)!.widths[0])).not.toBe(27.8);
});
it('retains zero macros but rejects missing, negative, nonfinite or zero-total macros', () => {
  const totals = { calories: '0', protein: '9', fat: '4', carbs: '9' };
  expect(macroShares(totals)?.tenths).toEqual([334, 333, 333]);
  expect(macroShares({ ...totals, protein: '0', fat: '0' })?.tenths).toEqual([
    0, 0, 1000,
  ]);
  for (const protein of [null, '-1', 'NaN', 'Infinity'])
    expect(macroShares({ ...totals, protein })).toBeNull();
  expect(
    macroShares({ ...totals, protein: '0', fat: '0', carbs: '0' }),
  ).toBeNull();
});
it('normalizes available meal calories without changing the diary total and never invents unknown shares', () => {
  const day = syntheticDay();
  day.meals.forEach((meal, index) => {
    meal.totals = { ...meal.totals, calories: index === 3 ? null : '1' };
  });
  day.totals = { ...day.totals, calories: '9' };
  expect(mealShares(day)).toMatchObject({
    percentages: [34, 33, 33, null],
    recordedOnly: true,
  });
  day.meals.forEach((meal) => {
    meal.totals = { ...meal.totals, calories: '0' };
  });
  expect(mealShares(day).percentages).toBeNull();
  expect(day.totals.calories).toBe('9');
});
