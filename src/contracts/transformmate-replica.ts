import { z } from 'zod';
export const transformMateReplicaStatusSchema = z.object({
  total: z.number().int().nonnegative(),
  descriptions: z.number().int().nonnegative(),
  videos: z.number().int().nonnegative(),
  previews: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  lastSuccessAt: z.iso.datetime().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  failedExercises: z
    .array(
      z.object({
        id: z.number().int().positive(),
        reason: z.enum([
          'storage',
          'waiting',
          'media_or_upstream',
          'invalid_media',
          'limit',
        ]),
        nextAttemptAt: z.iso.datetime(),
      }),
    )
    .max(5),
  reason: z.enum(['disconnected', 'auth', 'storage', 'upstream']).nullable(),
});
export type TransformMateReplicaStatus = z.infer<
  typeof transformMateReplicaStatusSchema
>;
export const replicaMessages = {
  title: 'База упражнений',
  filling: 'Наполняется',
  automatic: 'Автообновление',
  emptyConnected:
    'База начнёт наполняться автоматически. Здесь появятся описания, видео и превью.',
  saved: 'Сохранена',
  paused: 'Ожидает подключения',
  retrying: 'Повторим автоматически',
  catalog: 'в каталоге',
  catalogShare: 'каталога',
  details: 'Как хранится база',
  failures: 'Ошибки обработки',
  queue: 'В очереди',
  storageSize: 'Занято файлами',
  updated: 'Последнее сохранение',
  scheduled: 'Следующая обработка',
  reconnect: 'Подключение аккаунта',
  units: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'],
  description:
    'Каталог, видео и превью хранятся на вашем сервере без срока удаления. Обновления выполняются постепенно, примерно раз в месяц.',
  loading: 'Получаем состояние серверной копии…',
  unavailable:
    'Не удалось обновить состояние копии. Сервер продолжит работу; статус обновится автоматически.',
  empty:
    'Каталог ещё не загружен. После подключения сервер начнёт наполнять копию автоматически.',
  total: 'Упражнений',
  descriptions: 'Описания',
  videos: 'Видео',
  previews: 'Превью',
  bytes: 'Занято',
  pending: 'Ожидают обработки',
  errors: 'Ошибки обработки',
  failedExercise: 'Упражнение',
  failureReasons: {
    storage: 'Хранилище недоступно',
    waiting: 'Ожидает восстановления TransformMate',
    media_or_upstream: 'Не удалось обновить данные',
    invalid_media: 'Не удалось обработать медиа',
    limit: 'Превышен лимит размера файла',
  },
  lastSuccess: 'Последняя успешная обработка',
  nextAttempt: 'Следующая попытка',
  ready: 'Автоматическое обновление включено',
  disconnected:
    'Обновления остановлены: TransformMate отключён. Сохранённая копия доступна.',
  auth: 'Для продолжения обновлений подключите TransformMate заново. Сохранённая копия доступна.',
  storage:
    'Хранилище временно недоступно. Сервер повторит попытку автоматически.',
  upstream:
    'TransformMate временно недоступен. Сервер повторит попытку автоматически.',
} as const;
