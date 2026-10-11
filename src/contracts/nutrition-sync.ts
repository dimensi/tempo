import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';
import {
  timezoneSchema,
  dateInTimezone,
  shiftDate,
} from '@/contracts/nutrition-sync-dates';

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
      to: diaryDateSchema.optional(),
      timezone: timezoneSchema.optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('recent'),
      days: z.number().int().min(1).max(31),
      through: diaryDateSchema,
      timezone: timezoneSchema.optional(),
    })
    .strict(),
]);
export function resolveSyncPeriod(request: unknown, now = new Date()) {
  const input = syncRequestSchema.parse(request);
  const today = dateInTimezone(now, input.timezone);
  const period =
    input.mode === 'period'
      ? { from: input.from, to: input.to ?? today }
      : { from: shiftDate(input.through, 1 - input.days), to: input.through };
  return periodSchema
    .refine(
      (value) => value.from <= today && value.to <= today,
      'Future dates are not allowed',
    )
    .parse(period);
}
export const syncStatusSchema = z.object({
  state: z.enum(['idle', 'running', 'completed', 'partial', 'failed']),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  completedDates: z.array(diaryDateSchema),
  failedDates: z.array(diaryDateSchema),
  photoFailedDates: z.array(diaryDateSchema),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export const yazioAccountSchema = z.object({
  email: z.email().nullable(),
  name: z.string().max(201).nullable(),
  avatar: z.url().nullable(),
});
export type YazioAccount = z.infer<typeof yazioAccountSchema>;
export const yazioCredentialsSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(1024),
    timezone: timezoneSchema,
    initialFrom: diaryDateSchema,
  })
  .strict();
export type YazioCredentialsInput = z.infer<typeof yazioCredentialsSchema>;
export const yazioTokenImportSchema = z
  .object({
    token: z.unknown(),
    timezone: timezoneSchema,
    initialFrom: diaryDateSchema,
  })
  .strict();
export function resolveConnectionSchedule(
  input: { timezone: string; initialFrom: string },
  now = new Date(),
) {
  const timezone = timezoneSchema.parse(input.timezone);
  const initialFrom = diaryDateSchema.parse(input.initialFrom);
  resolveSyncPeriod({ mode: 'period', from: initialFrom, timezone }, now);
  return { timezone, initialFrom };
}
export const yazioConfirmationSchema = z
  .object({ confirmed: z.literal(true) })
  .strict();
export const nutritionSyncMessages = {
  title: 'Подключение YAZIO',
  configured: 'YAZIO подключён',
  absent: 'YAZIO не подключён',
  token: 'Существующий токен JSON',
  save: 'Подключить токен',
  email: 'Email аккаунта YAZIO',
  password: 'Пароль YAZIO',
  connect: 'Подключить и загрузить дневник',
  passwordVisibility: 'Показать или скрыть пароль YAZIO',
  connectionHelp:
    'Подключение хранится зашифрованным. Пароль не сохраняется. Загрузим дневник с выбранной даты по сегодня.',
  account: 'Аккаунт YAZIO',
  syncTitle: 'Синхронизация дневника',
  accountFallback: 'YAZIO подключён',
  accountHelp: 'Подключение хранится зашифрованным. Пароль не сохраняется.',
  disconnect: 'Отключить YAZIO',
  disconnectTitle: 'Отключить подключение YAZIO?',
  disconnectHelp:
    'Токены подключения будут удалены. Сохранённый дневник и фотографии останутся.',
  cancel: 'Отмена',
  loading: 'Загрузка…',
  storeUnavailable:
    'Подключение пока недоступно: администратору нужно настроить защищённое хранение подключения YAZIO.',
  httpsRequired: 'Для подключения YAZIO откройте приложение по HTTPS.',
  advanced: 'Дополнительные настройки',
  tokenHelp:
    'Необязательный импорт существующего JSON: token_type, access_token, refresh_token, expires_in, expires_at. Используйте значения из существующего токена; не заполняйте сроки вручную.',
  connectionLoaded: 'YAZIO подключён. Дневник загружен.',
  connectionPhotoWarning:
    'YAZIO подключён. Еда загружена; часть фотографий пока недоступна.',
  syncPhotoWarning: 'Еда обновлена; часть фотографий пока недоступна.',
  photoWarning: 'Некоторые фотографии пока недоступны.',
  foodStatus: 'Загрузка еды',
  connectionSyncFailed:
    'YAZIO подключён. Не удалось полностью загрузить дневник. Нажмите «Обновить сейчас», чтобы повторить.',
  syncLoaded: 'Дневник обновлён.',
  syncFailed:
    'Не удалось полностью обновить дневник. Подключение сохранено. Попробуйте ещё раз.',
  today: 'По сегодня',
  from: 'Загрузить данные начиная с…',
  to: 'Конец периода',
  period: 'Синхронизировать период',
  recent: 'Обновить сейчас',
  failure: 'Не удалось выполнить запрос',
  success: 'Запрос выполнен',
  hourly:
    'Каждый час обновляем последние 7 дней, включая сегодня, но не раньше выбранной даты. Историю можно загрузить кнопкой.',
  schedulerInactive:
    'Автоматическое обновление пока не включено на сервере. Можно обновить сейчас.',
  scheduleDisabled: 'Автоматическое обновление отключено.',
  lastSuccess: 'Последнее успешное обновление',
  nextRun: 'Следующее обновление',
  noRuns: 'Ещё не было',
  pendingRun: 'Пока не назначено',
  scheduledLoading: 'Загрузка дневника выполняется на сервере.',
  scheduleErrors: {
    NOT_CONFIGURED: 'Подключение недоступно. Переподключите YAZIO.',
    SYNC_FAILED:
      'Не удалось полностью загрузить дневник. Сервер повторит попытку.',
    PHOTO_INCOMPLETE:
      'Еда загружена, но не все фотографии доступны. Сервер повторит загрузку фото.',
    LEASE_LOST: 'Загрузка была прервана. Сервер повторит попытку.',
  },
  states: {
    idle: 'Ожидает загрузки',
    running: 'Загрузка',
    completed: 'Загружено',
    partial: 'Загружено частично',
    failed: 'Ошибка загрузки',
  },
  rangeInvalid:
    'Выберите корректный период до 366 дней, не позже сегодняшнего дня.',
  rangeHelp: 'Можно загрузить до 366 дней за один раз.',
  status: 'Статус синхронизации',
  forbidden: 'Доступ запрещён',
  invalid: 'Некорректный запрос',
};
