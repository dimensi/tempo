import 'server-only';

// Валидация ключей объектного хранилища. Отдельный модуль без импортов
// реализаций: fs/s3/index подключают его без циклов.

// Ключ — путь из сегментов строчных букв, цифр, дефисов и точек: точки
// допустимы для расширений. Паттерн анкерирован с обеих сторон, поэтому
// безопасный префикс с мусорным хвостом не проходит; «..» отсекается
// отдельной проверкой.
const keyPattern = /^[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*$/;

export function validateObjectKey(key: string): string {
  if (
    typeof key !== 'string' ||
    !keyPattern.test(key) ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.length > 400
  )
    throw new Error('Invalid storage key');
  return key;
}

// Пространство имён фичи: `feature/<сегменты>`.
export function storageNamespaceKey(namespace: string, ...segments: string[]) {
  return validateObjectKey([namespace, ...segments].join('/'));
}
