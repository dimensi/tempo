import Decimal from 'decimal.js';
import {
  meals,
  type NutritionDay,
  type NutritionTotals,
} from '@/contracts/nutrition';
import { syntheticDay } from './fixtures';

// Synthetic records only. No names/photos from the user's reference document.
export function redesignDay(date = '2026-10-11'): NutritionDay {
  const day = syntheticDay(date, 1);
  day.totals = {
    calories: '1460.5',
    protein: '98.75',
    fat: '76.55',
    carbs: '83.7',
  };
  day.knownTotals = { ...day.totals };
  day.officialTotals = { ...day.totals };
  day.delta = { calories: '0', protein: '0', fat: '0', carbs: '0' };
  const mealValues = [
    ['500', '30', '25', '25'],
    ['400', '25', '20', '20'],
    ['500', '43', '30', '35'],
    ['60.5', '0.75', '1.55', '3.7'],
  ];
  day.meals.forEach((meal, index) => {
    const values = mealValues[index]!;
    const totals: NutritionTotals = {
      calories: values[0]!,
      protein: values[1]!,
      fat: values[2]!,
      carbs: values[3]!,
    };
    meal.totals = totals;
    meal.knownTotals = { ...totals };
    meal.officialTotals = { ...totals };
    meal.delta = { calories: '0', protein: '0', fat: '0', carbs: '0' };
    const count = [1, 2, 2, 1][index]!;
    meal.entries = Array.from({ length: count }, (_, entryIndex) => {
      const base = syntheticDay(date).meals[0]!.entries[0]!;
      return {
        ...base,
        id: `synthetic-${date}-${index}-${entryIndex}`,
        meal: meals[index]!,
        name: `Синтетическое блюдо ${index + 1}.${entryIndex + 1}`,
        diaryDateTime: `${date} ${index === 3 ? '00:00:00' : '12:34:56'}`,
        amount: '20',
        massG: index === 1 && entryIndex === 0 ? '20' : null,
        serving: null,
        issues: index === 0 ? ['mass-unavailable'] : [],
        totals: {
          calories: new Decimal(totals.calories!).div(count).toString(),
          protein: new Decimal(totals.protein!).div(count).toString(),
          fat: new Decimal(totals.fat!).div(count).toString(),
          carbs: new Decimal(totals.carbs!).div(count).toString(),
        },
      };
    });
  });
  return day;
}
