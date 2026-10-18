# Tempo

Личное приложение для питания, тренировок и показателей здоровья с самостоятельным размещением. Владелец подключает свои аккаунты YAZIO и TransformMate, ведёт дневник и разрешает тренеру доступ к данным.

- Дневник питания, синхронизация YAZIO и приватные фотографии.
- Замеры, планы и результаты тренировок, каталог TransformMate и видео выполнения.
- Аналитика, комментарии и PDF-отчёты.
- Медицинские документы, лабораторные показатели и отдельные разрешения для тренера.
- Кеш загруженных данных и очередь записей при нестабильной сети.

Открытая регистрация отключена. Доступ проверяется на сервере; медицинские документы требуют отдельных разрешений. Подключения к внешним сервисам хранятся в зашифрованных файлах. Для распознавания лабораторных PDF приложение передаёт текст или изображения страниц в OpenRouter.

## Локальный запуск

Нужны Node.js 22.18+ (22.x), pnpm 9.15.4 и инструменты сборки SQLite: Xcode Command Line Tools на macOS или Python, make и g++ на Linux. Для обработки видео установите FFmpeg (`ffmpeg` и `ffprobe`).

```sh
git clone https://github.com/dimensi/tempo.git
cd tempo
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -base64 48
```

Вставьте сгенерированное значение в `BETTER_AUTH_SECRET` в `.env`. Для разработки оставьте `BETTER_AUTH_URL=http://localhost:3000` и `DATABASE_URL=file:./.data/development.sqlite`. В каждом worktree используйте отдельную базу.

```sh
pnpm db:migrate
pnpm db:seed
```

Создайте владельца через переменные окружения. В bash/zsh пароль можно ввести скрыто:

```sh
export CREATE_USER_EMAIL=you@example.com
export CREATE_USER_NAME=Owner
printf 'Password: '
read -r -s CREATE_USER_PASSWORD
export CREATE_USER_PASSWORD
pnpm auth:create-user
unset CREATE_USER_PASSWORD
pnpm dev
```

Откройте [localhost:3000](http://localhost:3000). В настройках подключите YAZIO и TransformMate; credentials этих сервисов для запуска приложения не нужны. Тренеров приглашает владелец через раздел настроек.

Для разработки доступны маркированные fixtures с `DEMO_MODE=true`; авторизация остаётся обязательной. Demo-режим запрещён в production. Базы, uploads, токены и локальные env-файлы не коммитьте.

## Проверки

```sh
pnpm exec playwright install --with-deps chromium
pnpm verify:merge
```

`verify:merge` запускается на чистом финальном коммите и выполняет форматирование, lint, typecheck, проверку бюджета тестов, unit/integration, production build и два browser smoke-сценария. Результат сохраняется в `test-results/merge-verification.json`. [Уровни проверок и ограничения](AGENTS.md).

Для отдельных проверок: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e smoke` или `pnpm test:e2e nutrition`.

## Развёртывание

Приложение работает в Docker: один Node.js процесс, SQLite и постоянные volumes `database` и `uploads`. Runtime включает Chromium, шрифты и FFmpeg; миграции применяются перед стартом. Production требует HTTPS, постоянного `BETTER_AUTH_SECRET` и `DEMO_MODE=false`.

[Release workflow](.github/workflows/release.yml) выполняется на стандартных GitHub-hosted Ubuntu runners при push в main или ручном запуске. На main он собирает и публикует `ghcr.io/dimensi/tempo:latest`, затем развёртывает полученный digest по SSH. Ручной запуск другой ветки публикует только `build-<branch-hash>` без деплоя. Рабочие слои Chromium/FFmpeg переиспользуются из GHCR через inline cache и `COPY --link`. PR-проверки и полный набор тестов в этом workflow не запускаются.

[Руководство оператора](docs/deployment.md) описывает конфигурацию, создание владельца и резервное копирование. [CD](docs/deployment-cd.md) — публикацию образа, deployment и восстановление после ошибок. При переименовании репозитория существующие серверные пути, Compose project и volumes сохраняются.

## Устройство проекта

Next.js App Router, React, Mantine, Better Auth, Drizzle и SQLite. Актуальные версии закреплены в `package.json` и `pnpm-lock.yaml`.

- `src/app` — страницы и API routes.
- `src/features` — интерфейсы отдельных функций.
- `src/contracts` — общие схемы и типы.
- `src/server` — авторизация, база, интеграции и фоновые задачи.
- `drizzle`, `scripts`, `tests` — миграции, операторские команды и проверки.

[Архитектура](docs/architecture/overview.md) · [Права доступа](docs/architecture/permissions.md) · [База данных](docs/architecture/database.md) · [Клиентский кеш](docs/architecture/client-read-cache.md) · [TransformMate](docs/architecture/transformmate-integration.md) · [API probe](docs/architecture/transformmate-probe.md) · [Разработка](docs/agents/parallel-development.md)
