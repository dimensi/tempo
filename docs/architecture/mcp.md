# Tempo MCP v1

## Архитектура и данные

`POST /api/mcp` — stateless Streamable HTTP, официальный `@modelcontextprotocol/server@2.3.1`, Node.js Route Handler существующего Next.js. На запрос создаётся сервер и транспорт, ответ — JSON. Подписки/SSE, MCP-сессии, prompts/resources и запись не предоставляются. GET/DELETE с авторизацией возвращают 405, без неё — 401 с discovery challenge.

Адаптер вызывает существующие `getAnalytics`, `listNutritionDays`, `listWorkouts`, `listTransformMateSync` и read-only accessor цели шагов. SQL и расчёты питания/замеров не копируются. Средние, подтверждённые дни, известная часть нутриентов, неоднозначные точки и темп изменения поступают из того же сервиса, что и `/analytics`. TransformMate читается из сохранённых linked/native DTO: refresh и write engine не вызываются.

В текущей модели сохраняется цель шагов, но нет отдельной цели калорий/веса или антропометрического профиля с ростом/возрастом; MCP возвращает явную недоступность этих полей. Анамнез, медицинские PDF, фотографии, видео, файлы, комментарии и credentials не входят в контракт.

## Инструменты и контракт

Ответ: `{version: 1, data: {...}, next_cursor: string|null}` в `structuredContent` и текстовом JSON. Discovery содержит schemas и read-only annotations.

| Tool                 | Summary по умолчанию                                                            | Детализация                                                                  |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| get_profile          | Единицы, OWNER, цель шагов и недоступность несохраняемых целей                  | Без аргументов, имени, почты и credentials                                   |
| get_nutrition        | Итоги/средние нутриентов, макросы, покрытие                                     | daily: качество и итоги по датам; records: продукты, масса/объём, КБЖУ       |
| get_body_metrics     | Конечные точки, разница, недельный темп, неоднозначность                        | daily/records: наблюдения, источники, единицы                                |
| get_activity         | Сумма, среднее шагов по наблюдавшимся дням, цель, покрытие                      | daily/records: даты, шаги или null                                           |
| get_workouts         | Постраничные LOCAL планы/сессии и linked/native TransformMate                   | records: плановые и фактические подходы отдельно, provider units/values/done |
| get_workout          | Одна тренировка по workoutRef, упражнения и связанные записи                    | records: отдельные плановые и фактические подходы                            |
| get_exercise_history | Фактические подходы по точному exerciseRef за период                            | summary: вхождения; records по умолчанию, до 366 дней                        |
| get_data_coverage    | Покрытие питания/замеров/шагов, количество сохранённых workout DTO каждого вида | daily/records: качество питания и наличие шагов по датам                     |

Исторические аргументы исходных инструментов: `from`, `to` включительно (YYYY-MM-DD); `timezone` (IANA, default UTC); `detail` (summary/daily/records, default summary); `limit` (1–50, default 20); `cursor`. Максимум 366 дней, для records — 31 день. У новых get_workout/get_exercise_history отдельные схемы, описанные ниже; история одного упражнения поддерживает records за 366 дней. Даты источников остаются календарными; timezone не переносит запись на другой день. Неизвестные поля, включая ownerId, отвергаются. Годы исторических запросов ограничены 1901–9998.

`get_workouts`: у каждой записи есть `executionStatus`: `planned`, `not_started`, `in_progress`, `completed`, `skipped` или `unknown`. LOCAL использует сохранённый статус сессии; план всегда `planned`. Для TransformMate завершение подтверждает `finished`; начало, выполненный подход или непустое фактическое значение (включая `"0"`) без завершения означают `in_progress`. Объект actual с пустыми подходами без начала/завершения — `not_started` и coverage `empty`; отсутствующий actual — `unknown` и `missing`. Плановые метрики не подтверждают выполнение. `coverage` описывает доступность данных, а не завершение; `provider_snapshot` также не означает выполненную тренировку.

`summary.completedSessions` — количество подтверждённых завершений за весь диапазон, одинаковое на всех страницах. `coverage.recordCounts` считает записи по kind, не тренировки. Если завершённые LOCAL и linked TransformMate имеют одинаковые planId/workoutId/date, `completionCountAmbiguous=true`, а `completedSessions=null`: связи с планом недостаточно для доказательства идентичности сессии. Не складывайте эти факты и не склеивайте их автоматически; сообщите неопределённость. Повторные LOCAL-сессии сохраняются отдельными. Linked/native дубли TransformMate уже исключаются существующим сервисом.

Сводки относятся ко всему диапазону, records — к странице. Для get_workouts даже summary постраничный; остальные summary не принимают cursor. Следующая страница повторяет tool, диапазон, timezone и detail с `next_cursor`. Cursor HMAC-подписан, привязан к владельцу/запросу, живёт час. Это живое представление, не snapshot: после изменения исходных записей между страницами начните чтение заново. Не суммируйте агрегаты между страницами.

КБЖУ и измерения сохраняют десятичные строки, шаги по датам — integer/null. Единицы есть в units, метриках и подходах. `null` означает неизвестное/отсутствующее, `0`/`"0"` — подтверждённый ноль. Питание различает complete/partial/empty/missing. Сохранённый пустой дневник не доказывает голодание и исключён из средних; knownTotals не заменяет полные totals. Пропуск замера не означает нулевой вес.

Workouts сохраняют kind и связи planId/workoutId. LOCAL план и linked-запись могут описывать одну тренировку — их нельзя считать двумя выполненными. Status сессии, provider started/finished, plan/fact и done не взаимозаменяемы. Пустая история не доказывает отдых, полнота upstream неизвестна. Обновление источников остаётся обычной функцией Tempo.

## Детали тренировок и история упражнений

`get_workouts` возвращает workoutRef на каждой строке: `{kind:"plan",planId,workoutId,date}`, `{kind:"session",id,date}`, `{kind:"linked",id,date}` или `{kind:"native",id:number,date}`. В упражнениях records есть historyRef: `{source:"TransformMate",exerciseId:number}` либо null. Название и UUID отдельного вхождения не являются идентификатором каталога.

`get_workout` принимает `{workoutRef,detail?,limit?,cursor?}`. Идентификатор определяет запись, date служит календарным контекстом чтения. По умолчанию detail=summary: records содержит строки recordType=exercise с phase=plan/actual, name, occurrenceId, historyRef, setCount и recordedSetCount. Detail=records возвращает отдельные подходы с order, recorded, reps/weightKg или исходными provider metrics/units/values/done. Строки recordType=related_workout содержат ссылки на связанные записи и также пагинируются; это не дополнительные выполненные тренировки. Для сессии план берётся из исторического planSnapshot, а не текущего плана; planBasis указывает происхождение плановых подходов. Отсутствующий и чужой идентификатор дают одинаковый not_found.

`get_exercise_history` принимает `{exerciseRef,from,to,timezone?,detail?,limit?,cursor?}`, период до 366 дней. По умолчанию detail=records: одна строка на фактический подход с workoutRef/date/source/executionStatus, именем и occurrenceId упражнения, historyRef, freshness и possibleOverlap. Summary выдаёт строки вхождений с количеством подходов. Включены completed и in_progress; планы, skipped и пустые provider-заготовки исключены. Подтверждением provider-подхода считается done=true либо непустое фактическое значение, включая "0"; пустая строка не подтверждает факт.

История связывается только по точному TransformMate exerciseId, в том числе сохранённому в LOCAL упражнении. Совпадение названий, позиций или UUID не создаёт связь. LOCAL без ссылки каталога доступен в деталях с historyRef=null. OccurrenceId относится к вхождению в указанной тренировке и phase, не к истории упражнения; при отсутствии собственного ID используется индекс сохранённого представления. Повторные вхождения сохраняются. Существующие linked/native исключения применяются к списку, истории и деталям cached native-снимка, ставшего linked.

LOCAL и linked факты выбранного упражнения с одинаковыми planId/workoutId/date помечаются possibleOverlap=true: они не объединяются, общий объём и число уникальных тренировок не рассчитываются. Детали показывают пустые фактические подходы с recorded=false, история их исключает. Незаполненный подход, записанный ноль и отсутствие истории различаются; пустая история не доказывает отдых.

Оба инструмента возвращают units и freshness: lastSavedAt для LOCAL, lastCheckedAt для linked с учётом updateAttempt, lastFetchedAt для native. Coverage относится к сохранённым данным, upstreamCompleteness=unknown. Последняя проверка не обязательно успешна. Пагинация: 1–50 строк (по умолчанию 20), существующие ограничения байтов и 10 000 строк, native до 40 страниц. Слишком большую отдельную строку не обрезаем: use_summary; слишком широкий период — narrow_range. Cursor привязан к владельцу, инструменту, идентификаторам, диапазону/дате и детализации; limit можно менять.

Доступ только OWNER с tempo:read, проверяется сервером до и после чтения; ownerId не принимается от клиента. Нет refresh, миграций, записи, URL файлов, видео или credentials. Список и история переиспользуют загрузку сохранённых тренировок; детали используют readWorkoutDetails.

Примеры arguments:

```json
{
  "workoutRef": {
    "kind": "session",
    "id": "<id из get_workouts>",
    "date": "2026-10-13"
  },
  "detail": "summary"
}
```

```json
{
  "exerciseRef": { "source": "TransformMate", "exerciseId": 501 },
  "from": "2026-01-01",
  "to": "2026-10-23",
  "detail": "records",
  "limit": 20
}
```

Примеры вопросов: «Открой тренировку и покажи план отдельно от факта»; «Покажи подходы этого упражнения за полгода, включая начатые тренировки; возможные пересечения источников отметь отдельно». Сначала получать workoutRef/historyRef из списка или деталей, не угадывать provider ID по названию.

## Свежесть сохранённых данных

`get_data_coverage.data.freshness` разделяет `nutrition`, `yazioWeight`, `steps`, `localMeasurements`, `transformmateLinked`, `transformmateNative`. `recordScope=requested_range`: даты и времена относятся только к сохранённым записям запрошенного диапазона и не зависят от страницы. `syncScope=latest_saved_status_not_range_verification`: сведения о последнем запуске глобальны и не подтверждают проверку всего диапазона.

Каждый блок содержит `source`, `state` (`ready` / `unavailable`), `latestRecordDate`, `lastFetchedAt`, `lastCheckedAt`, `syncState`. При `ready` и null-дате в диапазоне нет видимых сохранённых записей; `unavailable` означает, что метаданные прочитать не удалось. Null-время означает отсутствие сохранённого времени, а не ошибку или успешную проверку. Последняя дата — дата сохранённой записи/снимка, в том числе пустого или планового, не дата завершённой тренировки и не «всё проверено по эту дату». Даты источников не сдвигаются timezone; timestamps — ISO instants. Порога устаревания нет.

Для питания fetchedAt берётся из сохранённых дневников, для веса и шагов — observedAt отдельных снимков YAZIO. LOCAL-замеры могут включать ручные и импортированные записи: измеренная дата известна, время загрузки не сохраняется, syncState=`not_applicable` относится к чтению локальной таблицы, не к состоянию обмена с YAZIO. Для linked TransformMate доступно более позднее из checkedAt основной записи и updateAttempt.checkedAt последней сохранённой проверки (она не обязательно успешна), для native — fetchedAt видимых снимков. Их общий результат синхронизации не сохраняется: syncState=`unknown`, даже при наличии свежего снимка. `get_workouts.data.freshness` содержит те же два блока TransformMate за весь диапазон до пагинации.

Только питание предоставляет `lastRun` (startedAt, finishedAt, failedDates) и `automatic` (enabled, active, lastSuccessAt, lastErrorCode, nextRunAt) из существующего статуса дневника и планировщика. Отсутствующий запуск — syncState=`unknown`; running/completed/partial/failed относятся к данным еды. Ошибки только фотографий не становятся ошибками КБЖУ; PHOTO_INCOMPLETE не публикуется как lastErrorCode. Последний успех планировщика может предшествовать неудачному запуску. Пропущенные ранее загруженные даты не считаются повторно полученными; статус дневника не распространяется на вес/шаги. Старые данные сохраняются при ошибке обновления. Сырые ошибки, имена аккаунтов и credentials не возвращаются.

Чтение только OWNER, с повторной серверной проверкой владельца; используется существующее хранение и read-сервисы. MCP не вызывает обновление источников, не создаёт историю запусков, не пишет в БД и не делает upstream-запросы. Например: «Проверь свежесть данных за неделю. Отдельно укажи дату последней записи, время её загрузки/проверки и известный результат синхронизации. Не делай вывод о полном обновлении периода по одной записи».

## OAuth и ограничения

Better Auth OAuth Provider 1.7.7 работает в той же SQLite на текущем HTTPS-origin. Миграция 0019 аддитивно создаёт OAuth-таблицы. Регистрация пользователей и dynamic client registration отключены. Владелец в настройках создаёт конфиденциального клиента с точным HTTPS callback, PKCE S256 и явным consent.

Scope данных — `tempo:read`; `offline_access` разрешает refresh, не меняя offline-кеш приложения. Code живёт 5 минут, opaque access token — 15 минут, refresh — технически 100 лет с ротацией без окна повторного использования (провайдер требует конечный TTL); для пользователя подключение действует до явного отзыва. OAuth offline_access не привязан к браузерной сессии: выход или истечение cookie не отключают AI-клиент. После успешной выдачи кодом или refresh hook отвязывает только выпущенные access/refresh строки от browser sessionId до возврата credentials. Provider хранит хеши токенов, client secret шифруется текущим BETTER_AUTH_SECRET. OAuth flow и криптография предоставлены библиотекой.

На каждом запросе проверяются token, issuer, audience внешнего `/api/mcp`, scope, срок, отсутствие DPoP-binding, клиент и текущая роль OWNER. Владельца задаёт проверенный token. Сервисы повторяют проверку до/после чтения. Серверный WeakMap связывает конкретный объект Headers с read principal; входным заголовком эту привилегию создать нельзя. В MCP-ветке authorize разрешены только nutrition:read, measurements:read, workouts:read — запись, medical и export запрещены даже при ошибочном вызове другого сервиса. Browser API не начинают принимать MCP Bearer. Cookie на `/api/mcp` недостаточно.

Ограничений частоты и числа параллельных вызовов в MCP-адаптере нет: это личное подключение владельца. Ограничения объёма сохраняются: body 16 KiB и 5 секунд загрузки; 50 строк и около 48 KB строк/страницу. Structured JSON — максимум 64 KB (текстовая копия может удвоить wire payload). JSON-RPC batches отвергаются. Native история ограничена 40 страницами по 50 DTO, проекции — 10 000 строками. При превышении сузьте период; слишком большая отдельная запись требует summary.

HTTP: 401 с WWW-Authenticate для отсутствующего/недействительного token, 403 для scope/origin, 400 для malformed/oversize body, 415 для Content-Type. При наличии Origin разрешён только внешний origin Tempo. Безопасные tool errors: invalid_cursor, narrow_range, use_summary, access_denied, data_unavailable. Адаптер не логирует token, аргументы или аналитические ответы. На ingress также нельзя включать логирование Authorization, OAuth query и тел запросов/ответов.

## Подключение ChatGPT

Сверено с [официальной документацией OpenAI OAuth](https://developers.openai.com/plugins/build/auth). Приёмка конкретного аккаунта ChatGPT выполняется после публикации HTTPS endpoint; локальный тест протокола её не заменяет.

1. В управлении MCP ChatGPT добавьте `https://<tempo-host>/api/mcp`, выберите OAuth с заранее зарегистрированными credentials. Скопируйте **точный callback URL** своего подключения; не угадывайте его и не используйте wildcard.
2. В Tempo откройте **Настройки → AI-подключения · MCP** (`/settings#mcp`). Скопируйте адрес сервера, введите название и точный HTTPS Callback URL из ChatGPT. Нажмите «Создать подключение». Client ID и Client Secret появятся один раз; перенесите их в защищённые поля ChatGPT и закройте показ секрета. Секрет не сохраняется в браузерном кеше. Здесь же доступен список своих подключений и отзыв с подтверждением; TRAINER не может открыть API управления. Создание ограничено 20 клиентами за сутки и 50 активными клиентами на владельца. Список ограничен последними 100 регистрациями.

3. Перенесите client_id/client_secret из файла в защищённые поля OAuth клиента: auth method `client_secret_post`, scope `tempo:read offline_access`, PKCE S256. Не помещайте credentials или access token в prompt, сообщения, Git и логи.
4. Discovery: `/.well-known/oauth-protected-resource/api/mcp` → issuer `https://<tempo-host>/api/auth` → `/.well-known/oauth-authorization-server/api/auth`. Authorization/token/revoke: `/api/auth/oauth2/authorize`, `/api/auth/oauth2/token`, `/api/auth/oauth2/revoke`. Resource authorize/token — точный HTTPS `/api/mcp`.
5. Подключитесь, войдите OWNER на Tempo и подтвердите чтение. TRAINER не получает доступ даже с trainer_access. После подключения проверьте восемь инструментов и короткий запрос покрытия.

Если конкретная поверхность клиента требует только CIMD/DCR и не принимает provided credentials, она не совместима с закрытой registration policy v1. Не включайте открытую регистрацию как обход: используйте интерфейс с заранее зарегистрированным клиентом. End-to-end проверка именно ChatGPT остаётся отдельной приёмкой на опубликованном endpoint.

Для немедленного отключения откройте Настройки → AI-подключения · MCP, выберите подключение и подтвердите «Отозвать доступ».

Disabled проверяется при каждом чтении и refresh, включая после рестарта. Для нового подключения создайте новый client. AI-клиент может отзывать токены стандартным revoke endpoint. Для отключения MCP используйте отзыв клиента в настройках; выход из браузера не отзывает отдельное OAuth-подключение. Существующее подключение автоматически получает новый долгоживущий refresh token при очередном обновлении; старые отозванные или просроченные токены не восстанавливаются.

## Деплой и проверка

Используйте [существующий Coolify/GHCR rollout](../deployment-cd.md). Новый сервис, порт, volume, внешний OAuth-provider и scheduler не нужны. Сохраните BETTER_AUTH_SECRET, BETTER_AUTH_URL, SQLite и uploads. Сделайте обычный backup БД; image entrypoint применит миграцию до Next.js. Не добавляйте второй migration command.

До merge: Full `pnpm verify:merge` на чистом финальном коммите, `docker build -t nutrition-foundation .`, disposable `bash scripts/docker-smoke.sh`. Merge/deploy требуют отдельной авторизации. После разрешённого deploy проверьте revision/health, metadata 200 и анонимный MCP 401 с challenge. Затем создайте реального OAuth client. Production tokens не нужны для CI.

Не заменяйте `/api/mcp` и `/.well-known` cookie-login редиректами и не удаляйте Authorization/WWW-Authenticate на ingress. Supported deployment остаётся одним процессом SQLite WAL. При смене public host создайте ресурс/client заново; старый audience не сохраняется как fallback.

## Примеры запросов

- «Проверь полноту данных за 1–14 октября, затем покажи средние калории и белок по подтверждённым данным».
- «Как изменились вес и талия за 90 дней? Отметь неоднозначные точки и источники».
- «Сравни шаги за две недели с числом наблюдавшихся дней».
- «Покажи плановые и фактические подходы за неделю отдельно. Не считай LOCAL план и TransformMate-копию двумя тренировками».
- «Найди частичные дневники, затем запроси продукты только за эти даты».

Пример arguments: `{"from":"2026-10-01","to":"2026-10-14","detail":"summary","timezone":"Europe/Moscow"}`. Для следующей страницы повторите аргументы и передайте next_cursor как cursor.
