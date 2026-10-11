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
export const yazioCredentialsSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(1024),
  })
  .strict();
export type YazioCredentialsInput = z.infer<typeof yazioCredentialsSchema>;
export const nutritionSyncMessages = {
  title: 'Подключение YAZIO',
  configured: 'Токен подключён',
  absent: 'Токен не подключён',
  token: 'Существующий токен JSON',
  save: 'Подключить токен',
  email: 'Email аккаунта YAZIO',
  password: 'Пароль YAZIO',
  connect: 'Подключить YAZIO',
  passwordVisibility: 'Показать или скрыть пароль YAZIO',
  connectionHelp:
    'Введите email и пароль вашего аккаунта YAZIO. Пароль используется один раз и не сохраняется. Токены подключения хранятся зашифрованными и автоматически обновляются. Синхронизация запускается вашими кнопками ниже.',
  connectionConsent:
    'Разрешаю подключить YAZIO и сохранить зашифрованные токены для дальнейшей синхронизации',
  disconnect: 'Отключить YAZIO',
  disconnectTitle: 'Отключить подключение YAZIO?',
  disconnectHelp:
    'Токены подключения будут удалены. Сохранённый дневник и фотографии останутся.',
  cancel: 'Отмена',
  storeUnavailable:
    'Подключение пока недоступно: администратору нужно настроить защищённое хранение подключения YAZIO.',
  httpsRequired: 'Для подключения YAZIO откройте приложение по HTTPS.',
  advanced: 'Расширенные настройки: импорт токена',
  tokenHelp:
    'Необязательный импорт существующего JSON: token_type, access_token, refresh_token, expires_in, expires_at. Используйте значения из существующего токена; не заполняйте сроки вручную.',
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
