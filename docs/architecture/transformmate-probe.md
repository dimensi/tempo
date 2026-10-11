# TransformMate: Firebase session и локальные probes

Ветка `codex/transformmate-probe`, текущий worktree. Owned paths:
`src/server/transformmate`, `scripts/transformmate-*.ts`, task-specific unit tests,
эта документация, README, `.env.example`, `package.json`, `.gitignore`.
Upstream payload тренировок остаётся `unknown`. Контракты приложения, UI,
SQLite, cron и импорт тренировок не меняются. TransformMate вызывается только GET.

## Bootstrap

Из первого Firebase SSO/Charles один раз нужны Firebase API key и Firebase
refreshToken. Поместите их в локальный ignored `.env`:

```dotenv
TRANSFORMMATE_FIREBASE_API_KEY=...
TRANSFORMMATE_FIREBASE_REFRESH_TOKEN=...
```

Не коммитьте credentials. Google `oauthAccessToken` и `oauthIdToken` для регулярного
refresh не нужны и не подходят. `TRANSFORMMATE_ID_TOKEN` больше не читается:
копировать краткоживущий ID token вручную не требуется.

```sh
npm run transformmate:auth-probe
npm run transformmate:probe
npm run transformmate:probe -- --save
# Полные redacted ответы для исследования:
npm run transformmate:probe -- --save --raw
```

Обе команды загружают `.env`, не переопределяя уже заданные переменные процесса.
Auth-probe обращается только к Firebase и выводит `expiresIn`, `userId`, `projectId`
и boolean `refreshTokenRotated`. Обычный probe сначала обновляет ID token, затем
проверяет `/users/me/` и `/workouts/trainings/`. При ошибке `/users/me/` он
останавливается. В выводе статус, схема JWT и размер массива тренировок; для
объекта — keys. `--raw` выводит полные тела, ошибки показываются и без флага.

## Provider и HTTP client

`FirebaseSession` реализует `getIdToken({ forceRefresh? })`. Состояние приватное:
ID token, expiresAt, текущий refresh token. Cached ID token используется только
когда осталось **больше 60 секунд**; иначе выполняется refresh. Одновременные
запросы делят один in-flight refresh. `forceRefresh: true` пропускает кэш.

Refresh — POST `https://securetoken.googleapis.com/v1/token?key=...`,
`application/x-www-form-urlencoded`, `grant_type=refresh_token`, `refresh_token`.
Ответ валидируется перед обновлением состояния. `expiresAt` рассчитывается
из `expires_in`. [Официальный контракт Firebase](https://firebase.google.com/docs/reference/rest/auth#section-refresh-token).

TransformMate client получает provider, а не секрет из env. Перед каждым GET
он получает ID token и отправляет **JWT**, даже если Firebase вернул
`token_type: Bearer`. После 401 — один forced refresh и один повтор того же GET.
Второй 401 возвращает ошибку. После 403, других статусов или сетевой ошибки
повтора/forced refresh нет. Bearer fallback удалён. Cache выключен,
redirect запрещён, timeout каждого HTTP-запроса 30 секунд.

## Rotation и хранение

Новый `refresh_token` всегда принимается provider и используется в последующих
refresh. При изменении вызывается `onRefreshToken(newRefreshToken)`; callback может
быть async. В CLI callback выводит только
`Firebase refresh token rotated; persistence required`.
`getRefreshToken()` отдаёт текущий **секрет** будущему хранилищу; его нельзя
логировать или сериализовать. `getSessionInfo()` отдаёт безопасную копию
метаданных; `refreshTokenRotated` означает, что rotation был хотя бы один раз
за жизнь этого provider.

Состояние сейчас только в памяти процесса. CLI не изменяет `.env` и не сохраняет
rotated credential в файл/SQLite. После выхода новый refresh token не сохраняется;
callback — точка для отдельно согласованного persistence. Ошибка callback
возвращает `PERSISTENCE_CALLBACK_FAILED`, обновлённое состояние остаётся в памяти.
Никакого login flow или refresh Google OAuth tokens нет.

## Ошибки и секреты

`FirebaseRefreshError`: HTTP `status` (null при отсутствии ответа), Firebase `code`,
redacted `body`. Сохраняются `INVALID_REFRESH_TOKEN`, `TOKEN_EXPIRED`,
`USER_DISABLED`, `USER_NOT_FOUND`, `PROJECT_NUMBER_MISMATCH`; текст invalid API key
нормализуется в `INVALID_API_KEY`. Некорректный ответ — `INVALID_RESPONSE`,
сетевая ошибка — `NETWORK_ERROR`. CLI печатает только status/code.

`TransformMateApiError`: `status`, `statusText`, `contentType`, `isJson`, `body`.
Транспортные ошибки имеют фиксированное сообщение без исходной причины.
Provider/API key, refresh и все выданные ID tokens редактируются при попадании
в ответы; JSON token/Authorization поля также скрываются. Секреты и auth headers
не логируются. Перехватчики fetch и callback получают credentials по назначению:
ответственность за их собственные логи остаётся у вызывающего кода.

`--save` сохраняет тело JSON ответа тренировок (включая JSON ошибки) в
`.tmp/transformmate-trainings.json`, права 0600. `.tmp/` gitignored. Файл может
содержать личные данные; храните локально. Exit code 1 означает ошибку Firebase,
TransformMate, конфигурации, транспорта или файловой операции.

Unit tests проверяют форму Firebase refresh, кэш/expiry/force refresh, rotation,
конкурентные refresh, ошибки/redaction, JWT и ровно один retry после 401.
Общие проверки: format, lint, typecheck, unit/integration, build, E2E.
