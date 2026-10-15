# Local-first UI: практики и план внедрения

[ADR 002](../decisions/002-local-first-private-workspace.md) задаёт обязательные инварианты. Этот документ описывает реализацию поверх существующих offline controller, `ReadResourceStore`, IndexedDB fences, Service Worker и feature read-компонентов.

## Модули и интерфейсы

### Private read workspace

Workspace связывает access fence, URL, read resources и статусы, но не владеет feature-разметкой или mutations.

```ts
type AccessState =
  'unknown' | 'locally-allowed' | 'checking' | 'confirmed' | 'denied';
type Coverage = 'missing' | 'partial' | 'complete';

interface ReadResource<T> {
  data?: T;
  source?: 'memory' | 'storage' | 'network';
  savedAt?: number;
  coverage: Coverage;
  refreshing: boolean;
  error?: 'network' | 'unavailable' | 'denied';
}
```

Feature-код получает resource state и вызывает refresh. Он не знает про IndexedDB, Web Locks, BroadcastChannel или Service Worker. Интерфейс модуля остаётся маленьким; transport и persistence являются внутренними адаптерами.

### Route coordinator

Координатор работает только с каноническими same-origin read URL:

1. проверяет, что текущий fenced snapshot покрывает destination;
2. немедленно публикует saved URL через History и сохраняет текущий live tree в `Activity`;
3. параллельно выполняет bounded identity probe;
4. при успехе продолжает обычную Next navigation;
5. при transport failure оставляет saved view;
6. при denial полагается на общий synchronous conceal/purge path.

Mutation routes (`new`, `edit`, `results`, upload, sync, settings submit) не считаются saved read-routes и требуют живого авторизованного transport.

### Resource keys и coverage

Ключ включает route, отсортированные query parameters и текущий read fence. OWNER/TRAINER identifiers и credentials не записываются в browser-visible URL только ради кеша.

Полный query может удалить старую запись только в своей области. Частичная сводка аналитики, 15-дневный diary snapshot или усечённый medical summary не доказывают отсутствие данных за пределами coverage.

| Экран      | Saved key / источник                                | Семантика отсутствия                                                 |
| ---------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| Дневник    | дата + nutrition/photo/comment projections          | незагруженный день — `missing`; загруженный пустой день — `complete` |
| Тренировки | дата или canonical detail href                      | дата входит в `workoutDates`; неизвестный detail не угадывается      |
| Замеры     | measurement collection + weight range               | пустая подтверждённая коллекция отличается от ошибки чтения          |
| Аналитика  | `from + to + timezone` или покрытая compact summary | сравнение вне coverage отсутствует, а не равно нулю                  |

## Lifecycle

### Обычная проверка

`focus`, `pageshow`, `online` и периодическая проверка запускают `checking` без conceal. Текущие данные и view state остаются смонтированными. Успешный тот же scope обновляет generation/freshness и запускает refresh видимых ресурсов.

`offline` отменяет ненужный online flight и читает текущую локальную копию. Он не вызывает document navigation, reload или очистку UI.

### Security transition

Auth/provider mutation создаёт durable intent и синхронно вызывает conceal до ожидания lock. Purge, mutation и final purge выполняются под существующим Web Lock. `401/403` от same-origin data API, BroadcastChannel denial и fence mismatch используют тот же путь.

Transport timeout, `5xx`, storage quota и отсутствие Service Worker не являются denial. Они меняют только connection/resource error.

### Reconnect

После подтверждения identity OWNER сначала отправляет существующую ordered write queue, затем обновляет snapshot и видимые reads. TRAINER не отправляет owner writes. Неоткрытые query обновляются при следующем чтении. Ни один шаг не владеет навигацией, scroll или состоянием формы.

## Правила для feature-кода

- Инициализировать форму один раз; background data не сбрасывает локальный draft.
- Не очищать `data` перед GET и не показывать section-wide loader при повторном чтении.
- Показывать refresh/sync/error рядом с соответствующим ресурсом.
- Дату и фильтры кодировать в URL; ephemeral раскрытия и scroll — в session view state.
- Persist draft разрешать только через реестр безопасных полей. Очистка происходит после подтверждённой отправки, отмены или security purge.
- Любой новый disk-cached DTO добавлять в строгий Zod whitelist и тестировать на отказ credentials, signed URLs и upstream payloads.
- Использовать общие read-компоненты; не создавать отдельную offline-разметку.

## Этапы дальнейшей миграции

1. **Core lifecycle — выполнено:** проверки соединения не скрывают подтверждённый UI; saved core-route выбирается до identity/RSC.
2. **Единые feature views:** убрать оставшиеся ветвления между live и saved renderers у дневника, тренировок, замеров и аналитики. RSC передаёт только initial seed и permissions.
3. **Typed reconcile:** перенести feature merge-функции за интерфейс store; сохранить ссылочную идентичность неизменившихся records и явно передавать `complete/partial`.
4. **View state:** общий session adapter для scroll/раскрытий; IndexedDB registry только для разрешённых drafts. Существующая offline-write queue остаётся отдельной.
5. **Удаление старого пути:** после миграции всех поддержанных routes удалить дублирующий offline renderer и несовместимые browser records без shim.

Core/contracts/schema/navigation меняются последовательно в отдельной согласованной ветке. Feature-работы начинаются только после фиксации интерфейса; features не импортируют друг друга.

## Проверки

### Unit и integration

- saved route публикуется до завершения identity probe;
- `checking/refreshing/network error` сохраняют data;
- complete/partial reconcile и удаления ограничены coverage;
- stale scope response отбрасывается;
- denial conceal происходит до async cleanup;
- OWNER/TRAINER sessions, grant generation и route readers используют реальные server guards;
- несовместимый browser contract очищается, credentials не проходят whitelist.

### Browser

Для каждого основного экрана: выбрать дату/фильтр, раскрыть карточку, прокрутить, ввести разрешённый draft, потерять и вернуть сеть. URL, ввод, focus, scroll и mounted screen сохраняются; изменившийся record обновляется без полноэкранного loading.

Отдельно проверяются stalled transport при `navigator.onLine=true`, cold installed-PWA launch, Back/Forward, BFCache, две вкладки, logout/account switch, OWNER и TRAINER revoke, quota/eviction и Service Worker A→B. Отзыв, обнаруженный онлайн, должен скрыть данные до refresh.

Перед merge финальной реализации обязательны все три полных E2E-набора из `AGENTS.md` и полный production offline suite на том же SHA. Проверка Chromium mobile profile не объявляется физической проверкой iPhone/PWA.
