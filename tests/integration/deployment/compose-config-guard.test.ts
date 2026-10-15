import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import { afterAll, describe, expect, it, vi } from 'vitest';

// CI-guard: docker compose config на ОБОИХ compose-файлах с полностью
// синтетическим env и --env-file /dev/null (локальные .env/runtime.env не
// читаются). Наследование окружения — только технический allowlist для
// самого docker CLI; все переменные приложения задаются синтетически.
// Resolved-конфиг никогда не печатается, даже в сообщениях об ошибках.
// В CI отсутствие/ошибка Compose обязаны фейлить тест; локально без Compose
// тест явно пропускается.

const run = promisify(execFile);

const inCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

const SYNTHETIC = {
  // Обязательные для разрешения шаблонов переменные — синтетические.
  BETTER_AUTH_URL: 'https://synthetic.invalid',
  BETTER_AUTH_SECRET: 'synthetic-secret-'.padEnd(48, 'x'),
  NUTRITION_IMAGE: 'ghcr.io/dimensi/yazio-dashboard:synthetic-test',
  DEPLOYED_COMMIT: 'deadbeef'.repeat(5),
  APP_PORT: '3999',
  // Операционные переменные анамнеза — тестовые значения.
  S3_ENDPOINT: 'http://s3.invalid:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'synthetic-bucket',
  S3_ACCESS_KEY_ID: 'synthetic-access-key-id',
  S3_SECRET_ACCESS_KEY: 'synthetic-secret-access-key',
  ANAMNESIS_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_API_KEY: 'synthetic-llm-key',
  ANAMNESIS_LLM_MODEL: 'synthetic-model',
  ANAMNESIS_LLM_TIMEOUT_MS: '60000',
  ENABLE_ANAMNESIS_WORKER: 'false',
  // Задаём и фикстурную переменную: она обязана НЕ попасть в контейнер.
  ANAMNESIS_EXTRACTION_FIXTURE_SHA256: 'f'.repeat(64),
} as const;

const OPERATIONAL_KEYS = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'ANAMNESIS_LLM_BASE_URL',
  'OPENROUTER_API_KEY',
  'ANAMNESIS_LLM_MODEL',
  'ANAMNESIS_LLM_TIMEOUT_MS',
  'ENABLE_ANAMNESIS_WORKER',
] as const;

// Только то, что нужно самому docker CLI для запуска. Никаких переменных
// приложения, COMPOSE_*, DOCKER_* конфигов и секретов из окружения.
const SHELL_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
];

// Изолированный HOME и DOCKER_CONFIG: docker CLI не читает пользовательские
// конфиги/креды (~/.docker/config.json). CLI-плагины — это код, не креды:
// локальный каталог плагинов подключается симлинком (на CI плагины лежат
// в системных каталогах и находятся без него).
const isolatedHome = mkdtempSync(join(tmpdir(), 'compose-guard-'));
const dockerConfig = join(isolatedHome, '.docker');
mkdirSync(dockerConfig);
const userPlugins = join(homedir(), '.docker', 'cli-plugins');
if (existsSync(userPlugins)) {
  try {
    symlinkSync(userPlugins, join(dockerConfig, 'cli-plugins'), 'dir');
  } catch {
    // Каталог уже существует — оставляем как есть.
  }
}
afterAll(() => rmSync(isolatedHome, { recursive: true, force: true }));

function shellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
  } as NodeJS.ProcessEnv;
  for (const key of SHELL_ALLOWLIST)
    if (process.env[key] !== undefined) env[key] = process.env[key];
  env.HOME = isolatedHome;
  env.TMPDIR = isolatedHome;
  env.DOCKER_CONFIG = dockerConfig;
  return env;
}

function syntheticEnv(
  overrides: Record<string, string> = {},
  drop: readonly string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...shellEnv(), ...SYNTHETIC, ...overrides };
  for (const key of drop) delete env[key];
  return env;
}

type ComposeConfig = {
  services: Record<string, { environment?: Record<string, string> }>;
};

async function composeConfig(env: NodeJS.ProcessEnv): Promise<ComposeConfig> {
  try {
    const { stdout } = await run(
      'docker',
      [
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'compose.home.yaml',
        '--env-file',
        '/dev/null',
        'config',
        '--format',
        'json',
      ],
      { env, cwd: process.cwd(), timeout: 60_000 },
    );
    return JSON.parse(stdout) as ComposeConfig;
  } catch (error) {
    // stdout/stderr и resolved-конфиг не покидают тест даже при ошибке.
    const firstLine =
      error instanceof Error
        ? (error.message.split('\n')[0] ?? '')
        : String(error);
    throw new Error(
      `docker compose config failed (детали вывода скрыты): ${firstLine.slice(0, 160)}`,
    );
  }
}

async function composeAvailable(): Promise<boolean> {
  try {
    await run('docker', ['compose', 'version'], {
      env: shellEnv(),
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

// Вычисляем один раз вне describe: в CI отсутствие Compose фейлит тест,
// локально без Compose тест явно пропускается.
const composeReady = await composeAvailable();
const guard = !composeReady && !inCI ? it.skip : it;

function appEnvironment(config: ComposeConfig): Record<string, string> {
  return config.services.app?.environment ?? {};
}

// Схема проверяется на РЕАЛЬНОМ resolved app-env из compose, без подмен:
// значения передаются как есть (включая пустые строки и worker-флаг).
function resolveServerEnv(app: Record<string, string>) {
  return import('@/server/env').then(({ readServerEnv }) =>
    readServerEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'file:/app/data/nutrition.sqlite',
      BETTER_AUTH_URL: app.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: app.BETTER_AUTH_SECRET,
      UPLOADS_DIR: app.UPLOADS_DIR,
      DEMO_MODE: app.DEMO_MODE,
      YAZIO_TOKEN_FILE: app.YAZIO_TOKEN_FILE,
      ENABLE_NUTRITION_SCHEDULER: app.ENABLE_NUTRITION_SCHEDULER,
      TRANSFORMMATE_TOKEN_FILE: app.TRANSFORMMATE_TOKEN_FILE,
      ...Object.fromEntries(
        OPERATIONAL_KEYS.map((key) => [key, app[key] ?? '']),
      ),
    }),
  );
}

describe('docker compose config guard (synthetic env, both files)', () => {
  guard(
    'dummy values pass through exactly and reach the env schema',
    { timeout: 90_000 },
    async () => {
      if (inCI) expect(composeReady).toBe(true);
      const app = appEnvironment(await composeConfig(syntheticEnv()));

      for (const key of OPERATIONAL_KEYS)
        expect(app[key], key).toBe(SYNTHETIC[key as keyof typeof SYNTHETIC]);

      // Фикстурная переменная задана в env, но в контейнер не попадает.
      expect(app.ANAMNESIS_EXTRACTION_FIXTURE_SHA256).toBeUndefined();

      // Схема принимает именно resolved-значения (не исходный SYNTHETIC),
      // в production-режиме, без каких-либо сетевых обращений.
      const resolved = await resolveServerEnv(app);
      expect(resolved.S3_ENDPOINT).toBe('http://s3.invalid:8333');
      expect(resolved.S3_BUCKET).toBe('synthetic-bucket');
      expect(resolved.OPENROUTER_API_KEY).toBe('synthetic-llm-key');
      expect(resolved.ANAMNESIS_LLM_TIMEOUT_MS).toBe(60000);
      expect(resolved.ENABLE_ANAMNESIS_WORKER).toBe('false');
    },
  );

  guard(
    'unset operational keys resolve to safe template defaults',
    { timeout: 90_000 },
    async () => {
      if (inCI) expect(composeReady).toBe(true);
      const env = appEnvironment(
        await composeConfig(
          syntheticEnv({}, [
            ...OPERATIONAL_KEYS,
            'ANAMNESIS_EXTRACTION_FIXTURE_SHA256',
          ]),
        ),
      );

      // Шаблонные defaults: пустые endpoint/ключи, worker выключен.
      expect(env.S3_ENDPOINT).toBe('');
      expect(env.S3_ACCESS_KEY_ID).toBe('');
      expect(env.S3_SECRET_ACCESS_KEY).toBe('');
      expect(env.OPENROUTER_API_KEY).toBe('');
      expect(env.ENABLE_ANAMNESIS_WORKER).toBe('false');
      expect(env.S3_REGION).toBe('us-east-1');
      expect(env.S3_BUCKET).toBe('apps');

      const resolved = await resolveServerEnv(env);
      expect(resolved.S3_ENDPOINT).toBeUndefined();
      expect(resolved.OPENROUTER_API_KEY).toBeUndefined();
      expect(resolved.ENABLE_ANAMNESIS_WORKER).toBe('false');
      expect(resolved.ANAMNESIS_LLM_TIMEOUT_MS).toBe(120000);
    },
  );

  guard(
    'explicit empty optional values stay empty and schema defaults apply',
    { timeout: 90_000 },
    async () => {
      if (inCI) expect(composeReady).toBe(true);
      const app = appEnvironment(
        await composeConfig(
          syntheticEnv({
            S3_ENDPOINT: '',
            S3_ACCESS_KEY_ID: '',
            S3_SECRET_ACCESS_KEY: '',
            ANAMNESIS_LLM_BASE_URL: '',
            OPENROUTER_API_KEY: '',
            ANAMNESIS_LLM_MODEL: '',
            ANAMNESIS_LLM_TIMEOUT_MS: '',
            ENABLE_ANAMNESIS_WORKER: '',
          }),
        ),
      );

      // Переменные с пустым default (${X:-}) остаются пустыми; переменные
      // с непустым default (${X:-value}) при явной пустоте получают default —
      // семантика compose ':-'. Внешняя обработка не включается: endpoint,
      // ключи и LLM-ключ пусты, таймер выключен.
      expect(app.S3_ENDPOINT).toBe('');
      expect(app.S3_ACCESS_KEY_ID).toBe('');
      expect(app.S3_SECRET_ACCESS_KEY).toBe('');
      expect(app.OPENROUTER_API_KEY).toBe('');
      expect(app.ENABLE_ANAMNESIS_WORKER).toBe('false');
      expect(app.ANAMNESIS_LLM_BASE_URL).toBe('https://openrouter.ai/api/v1');
      expect(app.ANAMNESIS_LLM_MODEL).toBe('google/gemini-3.8-flash');
      expect(app.ANAMNESIS_LLM_TIMEOUT_MS).toBe('120000');

      // Пустые строки = unset для схемы: безопасные defaults сохраняются.
      const resolved = await resolveServerEnv(app);
      expect(resolved.S3_ENDPOINT).toBeUndefined();
      expect(resolved.OPENROUTER_API_KEY).toBeUndefined();
      expect(resolved.ENABLE_ANAMNESIS_WORKER).toBe('false');
      expect(resolved.ANAMNESIS_LLM_BASE_URL).toBe(
        'https://openrouter.ai/api/v1',
      );
      expect(resolved.ANAMNESIS_LLM_TIMEOUT_MS).toBe(120000);
    },
  );
});
