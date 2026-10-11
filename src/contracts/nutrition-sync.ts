import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';

export const ownerIdSchema = z.string().min(1).max(128);
export const periodSchema = z
  .object({ from: diaryDateSchema, to: diaryDateSchema })
  .strict()
  .superRefine((v, ctx) => {
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
    if (days < 0 || days >= 366)
      ctx.addIssue({
        code: 'custom',
        message: 'Period must contain 1–366 days',
      });
  });
export const syncRequestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('period'),
      from: diaryDateSchema,
      to: diaryDateSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('recent'),
      days: z.number().int().min(1).max(31),
      through: diaryDateSchema,
    })
    .strict(),
]);
export const syncStatusSchema = z.object({
  state: z.enum(['idle', 'running', 'completed', 'partial', 'failed']),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  completedDates: z.array(diaryDateSchema),
  failedDates: z.array(diaryDateSchema),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export const nutritionSyncMessages = {
  title: 'Подключение YAZIO',
  configured: 'Токен подключён',
  absent: 'Токен не подключён',
  token: 'Существующий токен JSON',
  save: 'Подключить токен',
  from: 'Начало периода',
  to: 'Конец периода',
  period: 'Синхронизировать период',
  recent: 'Обновить последние 7 дней',
  failure: 'Не удалось выполнить запрос',
  success: 'Запрос выполнен',
  status: 'Статус синхронизации',
  forbidden: 'Доступ запрещён',
  invalid: 'Некорректный запрос',
};
