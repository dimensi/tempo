# yazio-dashboard

Self-hosted личное пространство для питания, физических показателей и тренировок. Реализованы авторизация, адаптивный Mantine-каркас, дневник питания, ручная синхронизация YAZIO за период, приватные фотографии, замеры, планы и результаты тренировок, аналитика, комментарии и PDF-отчёты. Владелец приглашает тренеров и отзывает доступ через UI. Chromium и шрифты включены в runtime; наличие функции в main не означает её развёртывание на preview.

## Архитектура и стек

Одно приложение Next.js App Router: страницы → серверные permissions → Drizzle/SQLite или серверный адаптер YAZIO. Общие нормализованные контракты отделяют UI от внешнего API. Feature-модули независимы.

Next.js 16.4, React 19.3, Mantine 9.7.2, Recharts 3.10, Drizzle 0.45, Better Auth 1.7, Zod 4. Vitest 5, Playwright Test 1.64, TypeScript strict. Полные версии — `package.json` и `pnpm-lock.yaml`; причины выбора — [ADR](docs/decisions/001-foundation.md).

## Локальный запуск

Нужны Node.js 22.18+ (22.x), pnpm 9.15.4 и инструменты сборки нативного SQLite: Xcode Command Line Tools на macOS; Python, make, g++ на Linux.

```sh
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -base64 48
```

Вставьте результат генерации в `BETTER_AUTH_SECRET` в `.env`. `DATABASE_URL=file:./.data/development.sqlite` создаёт базу в текущем worktree; `BETTER_AUTH_URL=http://localhost:3000`. Не используйте префикс NEXT_PUBLIC для секретов. YAZIO credentials не нужны.

```sh
pnpm db:migrate
pnpm db:seed
pnpm auth:create-user
```

Перед последней командой задайте `CREATE_USER_EMAIL`, `CREATE_USER_NAME`, `CREATE_USER_PASSWORD` и необязательный `CREATE_USER_ROLE=OWNER` в окружении либо временно в локальном `.env`. Новый пароль аккаунта — 8–128 символов; обязательных специальных символов нет. В интерактивном bash/zsh пароль можно прочитать без echo и записи в history:

```sh
printf 'Password: '
read -r -s CREATE_USER_PASSWORD
export CREATE_USER_PASSWORD
export CREATE_USER_EMAIL=you@example.com
export CREATE_USER_NAME=Owner
pnpm auth:create-user
unset CREATE_USER_PASSWORD
pnpm dev
```

Откройте [localhost:3000](http://localhost:3000). Войти можно только созданным пользователем. Повторный owner блокируется уникальным индексом. Для тренера используйте `CREATE_USER_ROLE=TRAINER`; `GRANT_OWNER_ACCESS=true` явно разрешает доступ к данным owner. Без этого тренер может войти, но не читать данные владельца. Владелец управляет приглашениями и grants на `/settings#trainers`; тренер принимает одноразовое приглашение. Открытая регистрация отключена.

`DEMO_MODE=true` разрешает серверную загрузку маркированных fixtures для разработки. Авторизация остаётся обязательной. Рабочие страницы читают данные владельца; отсутствие данных отображается явно. В production demo запрещён.

## Команды и проверки

| Команда                                     | Назначение                                              |
| ------------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                                  | Next.js development server                              |
| `pnpm build` / `pnpm start`                 | Production build / local production server              |
| `pnpm lint`                                 | ESLint и ограничения зависимостей features              |
| `pnpm format` / `pnpm format:check`         | Prettier                                                |
| `pnpm typecheck`                            | Генерация типов маршрутов и strict TypeScript           |
| `pnpm test`                                 | Unit + SQLite integration                               |
| `pnpm test:e2e`                             | Реальные login/logout, роли, маршруты, тема и mobile    |
| `pnpm db:generate`                          | SQL-миграция из схемы                                   |
| `pnpm db:migrate`                           | Версионированные миграции                               |
| `pnpm db:seed`                              | Проверка готовности инфраструктурной базы без fake data |
| `pnpm auth:create-user`                     | Локальное создание owner/trainer                        |
| `pnpm db:backup /secure/path/backup.sqlite` | Online backup с учётом WAL                              |

Для E2E сначала `pnpm exec playwright install chromium` и `pnpm build`. CI smoke и проверки выбранных областей используют одну готовую сборку и до двух независимых production-серверов через localhost HTTPS. Каждый тест получает отдельный временный checkout, `.data/e2e.sqlite`, synthetic accounts, uploads/token stores и auth quotas; provider/offline-наборы пока запускаются последовательно. Автоматический CI запускается только после push в `main`: static checks, unit/integration, одна сборка для браузерных тестов, обязательный smoke и выбранные по diff проверки областей, отдельный Docker build/smoke. Полный production regression доступен только через ручной CI → Run workflow → full, без расписания. Ручной regression не публикует release image и не запускает автоматический CD. PR и feature-ветки автоматически не запускают CI. Правила выбора и команды — [deployment](docs/deployment.md).

`pnpm start` требует предварительно применённых миграций и production-конфигурации: HTTPS `BETTER_AUTH_URL`, сильный секрет и `DEMO_MODE=false`. Для локального HTTPS используйте reverse proxy. Для повседневной разработки используйте `pnpm dev`.

## TransformMate API probe

Локальный исследовательский клиент. В `.env` один раз задайте Firebase
credentials из первого SSO/Charles: `TRANSFORMMATE_FIREBASE_API_KEY` и
`TRANSFORMMATE_FIREBASE_REFRESH_TOKEN`.

```sh
npm run transformmate:auth-probe
npm run transformmate:probe -- --save
# Вместо 123 укажите ID из списка тренировок:
npm run transformmate:probe -- --training-id 123 --save
```

ID token обновляется автоматически; `TRANSFORMMATE_ID_TOKEN` больше не нужен
и не используется. Google `oauthAccessToken`/`oauthIdToken` для refresh не подходят.
Секреты нельзя коммитить. `--save` сохраняет JSON в ignored-файл
`.tmp/transformmate-trainings.json`; `--raw` печатает полные ответы.
[Кэш, rotation и диагностика](docs/architecture/transformmate-probe.md).

Клиент имеет типизированные `getTrainings()` / `getTraining(id)` с runtime validation
реального wire-контракта. CRUD/write методы используют отдельные DTO и подтверждённый APK + live probes PATCH contract.
[Write contract, lifecycle и ограничения](docs/architecture/transformmate-write.md).
[Каталог с фильтрами групп мышц, справочник, exercise detail, видео и заголовки клиента](docs/architecture/transformmate-exercises.md).
Редактор тренировок использует каталог и автоматически отправляет новые связанные планы;
фактические результаты сохраняются отдельно от ручной истории. Безопасные ограничения,
статусы и настройка описаны в [интеграции TransformMate](docs/architecture/transformmate-integration.md).

## Развёртывание

Preview доступен на [nutrition.dimensi.dev](https://nutrition.dimensi.dev). Исходная проверенная preview revision — `b8b8a1cd154063b713db417a7ab2c2d3d9388a8c`; это историческая точка проверки, а не указание текущего latest после обновлений. Оператор фиксирует точную deployed revision и image ID/digest при каждом релизе; изменения main автоматически не развёртываются. На home-server stack расположен в `/opt/compose/yazio-dashboard`, Compose project — `nutrition`. Server-local `compose.home.yaml` подключает external network `web` с alias `nutrition` и убирает host port; Caddy направляет публичный HTTPS hostname на приложение.

Runtime работает от пользователя node, применяет миграции перед стартом, хранит SQLite в `database`, приватные фотографии в `uploads`. В образ включены Chromium, соответствующий закреплённому Playwright, и DejaVu font; disposable Docker smoke проверяет PDF rendering, backup и restore. PDF product flow merged в main; live-проверка относится к конкретному развёрнутому релизу.

Первого владельца создаёт сам пользователь на сервере командой `bash /opt/compose/yazio-dashboard/bootstrap-owner.sh`: пароль вводится скрыто. OWNER уже создан пользователем; bootstrap нужен только для нового пустого stack. Разделение постоянного секрета и release-конфигурации, repository Compose и ротация новых backup sets описаны в [CD operator handoff](docs/deployment-cd.md); установка этих изменений требует отдельного согласованного шага.

В `/settings#connection` владелец вводит email/password YAZIO и выбирает начало загрузки; submit запускает сохранение зашифрованного подключения и серверную загрузку выбранного периода. Пароль не сохраняется, отдельного checkbox нет. Подключённый аккаунт показывает безопасную проекцию SDK-профиля или нейтральное состояние; форма входа скрыта до явного отключения. В `/settings#sync` кнопка «Обновить сейчас» загружает историю с выбранной даты по сегодня в часовом поясе браузера. Последний явно выбранный старт и timezone сохраняются. При `ENABLE_NUTRITION_SCHEDULER=true` один production Node сервер автоматически обновляет последние 7 дней, не раньше этого старта; ошибки фотографий не скрывают успешно загруженную еду и получают ограниченные повторные попытки. Отключение сохраняет дневник и фотографии. JSON import находится в дополнительных настройках и использует тот же защищённый store. Все секции, включая тренеров, находятся на одной странице `/settings`.

Пользователь согласовал encrypted token store `/app/data/yazio-token.json`; координатор активировал его в preview revision `a36fd75775d1033f611864f9ef3816046ae96d75`. Encryption key выводится из существующего `BETTER_AUTH_SECRET` с HKDF и owner context, новый постоянный секрет не создаётся. Резервировать нужно encrypted token file вместе с DB/uploads и сохранять тот же auth secret/owner ID для восстановления. Plaintext fallback отсутствует; rotation секрета или legacy JSON file требуют явной миграции либо переподключения. Реальный YAZIO token не настроен; проверки используют synthetic OAuth/upstream и настоящие сессии. Пользователь сам подключает аккаунт по HTTPS и проверяет live sync.

Подробности запуска, резервирования и rollback — [deployment](docs/deployment.md). Секреты устанавливает оператор; базы, uploads и token files не включаются в Git.

## Разработка несколькими агентами

Читайте [AGENTS.md](AGENTS.md), [parallel development](docs/agents/parallel-development.md), [feature boundaries](docs/agents/feature-boundaries.md), [task template](docs/agents/task-template.md).

[Architecture](docs/architecture/overview.md) · [Data flow](docs/architecture/data-flow.md) · [Permissions](docs/architecture/permissions.md) · [Database/migrations](docs/architecture/database.md) · [YAZIO](docs/architecture/yazio.md) · [Decisions](docs/decisions/001-foundation.md).

Секреты, базы и фотографии не коммитить. Контракты согласовываются до зависимых реализаций. Shared/core меняются отдельным согласованным шагом. Никаких прямых зависимостей между features.
