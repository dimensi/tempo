import { z } from 'zod';

export const stepsGoalSchema = z
  .object({
    dailyStepsGoal: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
export type StepsGoal = z.infer<typeof stepsGoalSchema>;
export const stepsGoalMessages = {
  title: 'Цель шагов',
  description:
    'Необязательная дневная цель для отчётов по питанию. К прошлым датам применяется текущая цель.',
  enabled: 'Использовать цель шагов',
  amount: 'Шагов в день',
  save: 'Сохранить цель',
  saved: 'Цель сохранена.',
  disabled: 'Цель выключена. В отчётах отображается только число шагов.',
  invalid: 'Укажите положительное целое число шагов.',
  failed: 'Не удалось сохранить цель. Повторите попытку.',
  denied: 'Нет доступа к настройке цели шагов.',
} as const;
