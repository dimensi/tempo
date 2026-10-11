# yazio-dashboard

Self-hosted личное пространство для питания, физических показателей и тренировок. Сейчас это работающий фундамент: авторизация, роли, адаптивный Mantine-каркас и страницы-заглушки. Дневник, синхронизация, аналитика и PDF ещё не реализованы.

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

Перед последней командой задайте `CREATE_USER_EMAIL`, `CREATE_USER_NAME`, `CREATE_USER_PASSWORD` и необязательный `CREATE_USER_ROLE=OWNER` в окружении либо временно в локальном `.env`. Пароль 12–128 символов. В интерактивном bash/zsh пароль можно прочитать без echo и записи в history:

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

Откройте [localhost:3000](http://localhost:3000). Войти можно только созданным пользователем. Повторный owner блокируется уникальным индексом. Для тренера используйте `CREATE_USER_ROLE=TRAINER`; `GRANT_OWNER_ACCESS=true` явно разрешает доступ к данным owner. Без этого тренер может войти, но не читать данные владельца. Управление пользователями в UI пока отсутствует.

`DEMO_MODE=true` разрешает серверную загрузку маркированных fixtures для разработки будущих features. Авторизация остаётся обязательной. Текущие placeholders не показывают фиктивную статистику. В production demo запрещён.

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

Для E2E сначала `pnpm exec playwright install chromium`. Тесты запускают свой development server на 3100 и пересоздают только `.data/e2e.sqlite`. CI на каждом PR проверяет форматирование, lint, types, unit/integration, build, E2E и Docker smoke.

`pnpm start` требует предварительно применённых миграций и production-конфигурации: HTTPS `BETTER_AUTH_URL`, сильный секрет и `DEMO_MODE=false`. Для локального HTTPS используйте reverse proxy. Для повседневной разработки используйте `pnpm dev`.

## Docker / Portainer / Cloudflare Tunnel

```sh
# В .env: BETTER_AUTH_URL=https://nutrition.dimensi.dev
# BETTER_AUTH_SECRET=<случайный секрет минимум 32 символа>
docker compose up -d --build
```

При старте применяются миграции. SQLite хранится в volume `database`, будущие фотографии — `uploads`. Контейнер работает от пользователя node. Сервис опубликован только на `127.0.0.1:3000`, для tunnel на хосте. Chromium в образ не установлен.

Создание owner внутри контейнера: передайте те же `CREATE_USER_*` переменные в `docker compose exec -e … app node scripts/create-user.mjs`; не помещайте пароль в shell history. CLI bundled в production image. Для Portainer Git stack используйте репозиторий и `compose.yaml`, добавьте секрет и HTTPS URL через environment settings. Image можно собрать на сервере; registry publishing этим PR не настроен.

В **существующем** Cloudflare Tunnel добавьте маршрут `nutrition.dimensi.dev` → `http://localhost:3000`, если cloudflared работает на хосте. Если cloudflared в Docker, подключите его и app к одной уже существующей Docker network и направьте на `http://app:3000`; loopback внутри cloudflared не является хостом. Детали: [deployment](docs/deployment.md).

Production infrastructure и Tunnel этим PR не изменяются. Секреты и токены устанавливает оператор; открытая регистрация отсутствует.

## Разработка несколькими агентами

Читайте [AGENTS.md](AGENTS.md), [parallel development](docs/agents/parallel-development.md), [feature boundaries](docs/agents/feature-boundaries.md), [task template](docs/agents/task-template.md).

[Architecture](docs/architecture/overview.md) · [Data flow](docs/architecture/data-flow.md) · [Permissions](docs/architecture/permissions.md) · [Database/migrations](docs/architecture/database.md) · [YAZIO](docs/architecture/yazio.md) · [Decisions](docs/decisions/001-foundation.md).

Секреты, базы и фотографии не коммитить. Контракты согласовываются до зависимых реализаций. Shared/core меняются отдельным согласованным шагом. Никаких прямых зависимостей между features.
