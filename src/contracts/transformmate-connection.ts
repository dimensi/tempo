import { z } from 'zod';

const credential = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^\S+$/)
    .refine((value) =>
      [...value].every((char) => {
        const code = char.charCodeAt(0);
        return code > 31 && code !== 127;
      }),
    );

export const transformMateCredentialsSchema = z.strictObject({
  apiKey: credential(512),
  refreshToken: credential(8192),
});
export const transformMateDisconnectSchema = z.strictObject({});
export const transformMateConnectionStatusSchema = z.strictObject({
  configured: z.boolean(),
  account: z
    .strictObject({
      id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      name: z.string().max(300).nullable(),
      email: z.string().max(320).nullable(),
    })
    .nullable(),
  checkedAt: z.iso.datetime().nullable(),
  errorCode: z
    .enum([
      'reauth_required',
      'upstream_error',
      'storage_error',
      'account_mismatch',
      'connection_changed',
    ])
    .nullable(),
});
export type TransformMateConnectionStatus = z.infer<
  typeof transformMateConnectionStatusSchema
>;

export const transformMateConnectionMessages = {
  title: 'TransformMate',
  description: 'Подключите аккаунт для отправки планов и чтения результатов.',
  credentialsHint:
    'Введите API key и Firebase refresh token из вашего подключения TransformMate. Это не пароль Google и не access token. Данные отправляются только серверу вашего дашборда.',
  apiKey: 'Firebase API key',
  refreshToken: 'Firebase refresh token',
  connect: 'Подключить',
  reconnect: 'Подключить заново',
  check: 'Проверить подключение',
  disconnect: 'Отключить',
  connected: 'Аккаунт подключён',
  disconnected: 'Аккаунт не подключён',
  account: 'Аккаунт',
  checked: 'Последняя успешная проверка',
  unknownAccount: 'Аккаунт TransformMate',
  loading: 'Проверяем подключение…',
  saved: 'Подключение сохранено.',
  removed:
    'Подключение отключено. Планы и сохранённые результаты остаются в дашборде.',
  invalid: 'Проверьте API key и Firebase refresh token.',
  requestError: 'Не удалось выполнить действие. Попробуйте ещё раз.',
  noAccess: 'Подключение доступно только владельцу.',
  reauth_required:
    'Подключение больше не действует. Введите актуальные данные подключения.',
  upstream_error:
    'TransformMate временно недоступен. Повторите проверку позже.',
  storage_error: 'Не удалось открыть защищённое хранилище подключения.',
  account_mismatch:
    'Этот аккаунт не совпадает с аккаунтом связанных тренировок. Подключите прежний аккаунт.',
  connection_changed:
    'Подключение уже изменилось. Обновите статус и повторите действие.',
} as const;
