import { z } from 'zod';
import { nonnegativeDecimalSchema } from './nutrition';
export const dailyGoalsSchema = z.strictObject({
  date: z.iso.date(),
  calories: nonnegativeDecimalSchema.nullable(),
  weight: nonnegativeDecimalSchema.nullable(),
  steps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  fetchedAt: z.iso.datetime().nullable(),
});
export type DailyGoals = z.infer<typeof dailyGoalsSchema>;
export const goalMessages = {
  settingsTitle: 'Цели',
  stepsTitle: 'Шаги',
  calories: 'Цель калорий',
  steps: 'Цель шагов',
  weight: 'Целевой вес',
  kg: 'кг',
  missing: 'Не установлена',
  actual: 'Факт',
  goal: 'Цель',
  remaining: 'Осталось',
  over: 'Сверх цели',
  kcal: 'ккал',
  stepsUnit: 'шагов',
  deviation: 'Среднее отклонение от цели',
  achievement: 'Цель шагов достигнута',
  days: 'дней',
} as const;
