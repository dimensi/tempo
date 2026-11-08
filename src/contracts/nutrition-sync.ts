import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';
import {
  timezoneSchema,
  dateInTimezone,
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
  z.strictObject({
    mode: z.literal('history'),
    from: diaryDateSchema,
    timezone: timezoneSchema,
  }),
  z.strictObject({
    mode: z.literal('recent'),
    timezone: timezoneSchema,
  }),
]);
export function resolveSyncPeriod(
  input: { from: string; to?: string; timezone: string },
  now = new Date(),
) {
  const today = dateInTimezone(now, input.timezone);
  return periodSchema
    .refine(
      (value) => value.from <= today && value.to <= today,
      'Future dates are not allowed',
    )
    .parse({ from: input.from, to: input.to ?? today });
}
export const syncStatusSchema = z.object({
  state: z.enum(['idle', 'running', 'completed', 'partial', 'failed']),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  completedDates: z.array(diaryDateSchema),
  skippedDates: z.array(diaryDateSchema),
  failedDates: z.array(diaryDateSchema),
  photoFailedDates: z.array(diaryDateSchema),
  failedStepsDates: z.array(diaryDateSchema).optional(),
  failedWeightDates: z.array(diaryDateSchema).optional(),
  failedGoalsDates: z.array(diaryDateSchema).optional(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export const nutritionActivitySchema = z.object({
  id: z.string(),
  revision: z.number(),
  steps: z.array(diaryDateSchema),
  food: z.array(diaryDateSchema),
  photos: z.array(diaryDateSchema),
  other: z.boolean(),
});
export type NutritionActivity = z.infer<typeof nutritionActivitySchema>;
export const nutritionLiveStatusSchema = z.object({
  activity: nutritionActivitySchema.nullable(),
  last: syncStatusSchema,
  schedule: z.object({
    lastSuccess: z.iso.datetime().nullable(),
    lastAttempt: z.iso.datetime().nullable(),
    hasError: z.boolean(),
    scheduled: z.boolean(),
  }),
});
export type NutritionLiveStatus = z.infer<typeof nutritionLiveStatusSchema>;

export function syncResultKind(sync: SyncStatus) {
  const foodLoaded =
    (sync.state === 'completed' || sync.state === 'partial') &&
    (sync.completedDates.length > 0 || sync.skippedDates.length > 0) &&
    sync.failedDates.length === 0;
  if (!foodLoaded) return 'incomplete';
  if (sync.photoFailedDates.length > 0) return 'photos-pending';
  return sync.state === 'completed' ? 'loaded' : 'incomplete';
}
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
export function resolveConnectionSchedule(
  input: { timezone: string; initialFrom: string },
  now = new Date(),
) {
  const timezone = timezoneSchema.parse(input.timezone);
  const initialFrom = diaryDateSchema.parse(input.initialFrom);
  resolveSyncPeriod({ from: initialFrom, timezone }, now);
  return { timezone, initialFrom };
}
export const yazioConfirmationSchema = z
  .object({ confirmed: z.literal(true) })
  .strict();
export const nutritionSyncMessages = {
  title: 'Подключение YAZIO',
  configured: 'YAZIO подключён',
  absent: 'YAZIO не подключён',
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
  connectionLoaded: 'YAZIO подключён. Дневник загружен.',
  connectionPhotoWarning:
    'YAZIO подключён. Еда загружена; часть фотографий пока недоступна.',
  syncPhotoWarning: 'Еда обновлена; часть фотографий пока недоступна.',
  photoWarning: 'Некоторые фотографии пока недоступны.',
  foodStatus: 'Загрузка еды',
  connectionSyncFailed:
    'YAZIO подключён. Не удалось полностью загрузить дневник. Повторите загрузку в разделе «Синхронизация дневника».',
  syncLoaded: 'Дневник обновлён.',
  syncFailed:
    'Не удалось полностью обновить дневник. Подключение сохранено. Попробуйте ещё раз.',
  from: 'С какой даты загружать данные',
  history: 'Сохранить и загрузить историю',
  recent: 'Перепроверить последние 7 дней',
  historyHelp:
    'Загрузим историю с выбранной даты по сегодня. Ранее загруженные записи сохранятся.',
  recentHelp:
    'Повторно проверим данные за сегодня и шесть предыдущих дней, начиная не раньше сохранённой даты.',
  syncBusy: 'Синхронизация уже идёт. Дождитесь завершения и повторите.',
  recentDisabled: 'Сначала подключите YAZIO.',
  auxiliaryWarning: 'Часть шагов, целей или веса не удалось обновить.',

  failure: 'Не удалось выполнить запрос',
  success: 'Запрос выполнен',
  automatic:
    'Сервер проверяет сегодня и вчера раз в час, даже когда Tempo закрыт.',
  overviewAutomatic:
    'При открытии обзора проверяем сегодня и вчера не чаще раза в час.',
  skipped: 'Уже загружено ранее',
  schedulerInactive: 'Плановое обновление на сервере выключено.',
  scheduleDisabled: 'Автоматическое обновление отключено.',
  lastSuccess: 'Последнее успешное обновление',
  noRuns: 'Ещё не было',
  scheduledLoading: 'Загрузка дневника выполняется на сервере.',
  scheduleErrors: {
    NOT_CONFIGURED: 'Подключение недоступно. Переподключите YAZIO.',
    SYNC_FAILED:
      'Не удалось полностью загрузить дневник. Повторите обновление вручную или вернитесь в обзор позже.',
    PHOTO_INCOMPLETE:
      'Еда загружена, но не все фотографии доступны. Повторите обновление вручную или вернитесь в обзор позже.',
    LEASE_LOST:
      'Загрузка была прервана. Повторите обновление вручную или вернитесь в обзор позже.',
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
