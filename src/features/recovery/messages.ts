import type { RecoveryMetric, RecoveryUnit } from '@/contracts/recovery';
import { ru } from '@/config/messages';

export const recoveryMessages = {
  title: ru.recoveryTitle,
  source: 'Apple Health через Health Auto Export',
  settings: 'Настройки Apple Health',
  recent: 'Основной сон последнего дня',
  duration: 'Продолжительность сна',
  fellAsleep: 'Засыпание',
  wokeUp: 'Пробуждение',
  awake: 'Бодрствование',
  inBed: 'В постели в пределах эпизода',
  stages: 'Фазы сна',
  deviceSources: 'Источники в Apple Health',
  noStages: 'Нет данных о фазах сна.',
  noSleep: 'За этот период нет записей сна.',
  noData: 'За этот период нет данных Apple Health.',
  noDataHelp: 'Проверьте подключение или выберите другой период.',
  trend: 'Тенденции',
  history: 'История',
  period: 'Период',
  week: '7 дней',
  fortnight: '14 дней',
  previous: 'Предыдущий период',
  next: 'Следующий период',
  average: 'Среднее',
  total: 'Всего сна',
  count: 'Дней с данными',
  observations: 'Записей',
  metricSelect: 'Показатель восстановления',
  chartDays: 'Дни без записей показаны пропусками.',
  sleepChart: 'Продолжительность сна по дням',
  sleepLimit:
    'В этом периоде слишком много записей. Выберите 7 дней или другой период.',
  loadError: 'Не удалось загрузить данные Apple Health.',
  stagesLabels: {
    core: 'Основной',
    deep: 'Глубокий',
    rem: 'Быстрый',
    unspecified: 'Без уточнения',
  },
  metrics: {
    heart_rate_variability: 'Вариабельность сердечного ритма (HRV)',
    resting_heart_rate: 'Пульс в покое',
    night_heart_rate: 'Пульс во сне',
    respiratory_rate: 'Частота дыхания',
    apple_sleeping_wrist_temperature: 'Температура запястья во сне',
    blood_oxygen_saturation: 'Насыщение крови кислородом',
    breathing_disturbances: 'Нарушения дыхания во сне',
  } satisfies Record<RecoveryMetric, string>,
  units: {
    ms: 'мс',
    bpm: 'уд/мин',
    'breaths/min': 'вдохов/мин',
    '°C': '°C',
    '%': '%',
    count: '',
  } satisfies Record<RecoveryUnit, string>,
} as const;

export const healthAutoExportMessages = {
  title: 'Apple Health · Health Auto Export',
  description:
    'Отправляйте сон и показатели восстановления из приложения Health Auto Export на iPhone.',
  endpoint: 'URL для REST API Automation',
  copyUrl: 'Скопировать URL',
  token: 'Токен',
  copyToken: 'Скопировать токен',
  copied: 'Скопировано',
  once: 'Скопируйте токен для заголовка Authorization. После закрытия Tempo больше не покажет его.',
  authorizationHeader: 'Заголовок Authorization',
  tokenSaved: 'Я сохранил токен',
  create: 'Создать токен',
  rotate: 'Заменить токен',
  revoke: 'Отозвать токен',
  rotatePrompt:
    'Прежний токен сразу перестанет работать. Укажите новый токен в автоматизации на iPhone.',
  revokePrompt:
    'Автоматизация на iPhone потеряет доступ. Импортированные записи сохранятся.',
  confirmRotate: 'Подтвердить замену',
  confirmRevoke: 'Подтвердить отзыв',
  cancel: 'Отмена',
  tokenActive: 'Токен активен',
  noToken: 'Токен не создан',
  lastSuccess: 'Последняя успешная передача',
  lastAttempt: 'Последняя попытка',
  records: 'Новых записей при последней успешной передаче',
  lastError: 'Последняя ошибка',
  noError: 'Нет',
  noAttempt: 'Ещё не было',
  refresh: 'Обновить статус',
  connectHelp:
    'Откройте Health Auto Export → Export → Automated → New Automation → REST API. Добавьте URL, заголовок Authorization и выберите JSON.',
  insecure:
    'Для подключения укажите публичный HTTPS-адрес Tempo в настройках сервера.',
  offline: 'Для управления токеном нужно подключение к сети.',
  loadError: 'Не удалось загрузить статус Apple Health.',
  operationError:
    'Не удалось изменить токен. Обновите статус и повторите попытку.',
  errors: {
    invalid_payload:
      'Формат данных не распознан. Проверьте версию JSON и выбранные метрики.',
    json_required:
      'Запрос должен содержать JSON. Проверьте формат передачи в Health Auto Export.',
    payload_too_large:
      'Слишком большой экспорт. Отправьте историю по меньшим периодам.',
    body_timeout:
      'Передача заняла слишком много времени. Повторите отправку за более короткий период.',
    import_unavailable:
      'Tempo не смог сохранить данные. Повторите передачу в Health Auto Export.',
  },
} as const;
