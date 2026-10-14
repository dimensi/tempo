import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));
import { describe, expect, it, vi } from 'vitest';

// Контракт операционного запуска: compose-шаблон прокидывает S3_*/ANAMNESIS_LLM_*
// с безопасными defaults и не включает ни S3, ни внешнюю обработку, ни
// тестовые переменные. Блок environment разбирается структурно (пары
// «KEY: value» с отступом 6 пробелов, комментарии пропускаются).

const compose = readFileSync('compose.yaml', 'utf8');
const composeHome = readFileSync('compose.home.yaml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

const ANAMNESIS_OPERATIONAL_KEYS = [
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

function environmentEntries(source: string): Map<string, string> {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'environment:');
  const entries = new Map<string, string>();
  if (start === -1) return entries;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^ {6}([A-Z0-9_]+): (.*)$/);
    if (!match) break;
    entries.set(match[1]!, match[2]!.trim());
  }
  return entries;
}

const appEnv = environmentEntries(compose);
const homeEnv = environmentEntries(composeHome);

const baseEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'file:./.data/development.sqlite',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 's'.repeat(48),
} as const;

describe('compose template passes anamnesis operational env through', () => {
  it('forwards S3_* with fs-safe empty defaults', () => {
    expect(appEnv.get('S3_ENDPOINT')).toBe('${S3_ENDPOINT:-}');
    expect(appEnv.get('S3_ACCESS_KEY_ID')).toBe('${S3_ACCESS_KEY_ID:-}');
    expect(appEnv.get('S3_SECRET_ACCESS_KEY')).toBe(
      '${S3_SECRET_ACCESS_KEY:-}',
    );
    expect(appEnv.get('S3_REGION')).toBe('${S3_REGION:-us-east-1}');
    expect(appEnv.get('S3_BUCKET')).toBe('${S3_BUCKET:-apps}');
  });

  it('forwards ANAMNESIS_LLM_* without enabling external processing', () => {
    expect(appEnv.get('OPENROUTER_API_KEY')).toBe('${OPENROUTER_API_KEY:-}');
    expect(appEnv.get('ANAMNESIS_LLM_BASE_URL')).toBe(
      '${ANAMNESIS_LLM_BASE_URL:-https://openrouter.ai/api/v1}',
    );
    expect(appEnv.get('ANAMNESIS_LLM_MODEL')).toBe(
      '${ANAMNESIS_LLM_MODEL:-google/gemini-2.5-flash-lite}',
    );
    expect(appEnv.get('ANAMNESIS_LLM_TIMEOUT_MS')).toBe(
      '${ANAMNESIS_LLM_TIMEOUT_MS:-120000}',
    );
  });

  it('keeps the worker timer off by default', () => {
    expect(appEnv.get('ENABLE_ANAMNESIS_WORKER')).toBe(
      '${ENABLE_ANAMNESIS_WORKER:-false}',
    );
  });

  it('never forwards the E2E fixture variable into deployments', () => {
    expect(appEnv.has('ANAMNESIS_EXTRACTION_FIXTURE_SHA256')).toBe(false);
    expect(compose).not.toContain('ANAMNESIS_EXTRACTION_FIXTURE_SHA256');
    expect(composeHome).not.toContain('ANAMNESIS_EXTRACTION_FIXTURE_SHA256');
  });

  it('keeps the home override free of S3/LLM activation', () => {
    // Тот же структурный разбор: ни один операционный ключ анамнеза не
    // закреплён в home-оверрае — активация возможна только через env проекта.
    for (const key of ANAMNESIS_OPERATIONAL_KEYS)
      expect(homeEnv.has(key), key).toBe(false);
  });

  it('lists every forwarded variable in .env.example', () => {
    for (const key of ANAMNESIS_OPERATIONAL_KEYS)
      expect(envExample, key).toMatch(new RegExp(`^${key}=`, 'm'));
  });
});

describe('server env defaults stay local and offline', () => {
  it('defaults to fs storage, no LLM key and no worker timer', async () => {
    const { readServerEnv } = await import('@/server/env');
    const env = readServerEnv(baseEnv);
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_ACCESS_KEY_ID).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.ENABLE_ANAMNESIS_WORKER).toBe('false');
  });

  it('treats empty compose passthrough strings as unset', async () => {
    const { readServerEnv } = await import('@/server/env');
    const env = readServerEnv({
      ...baseEnv,
      S3_ENDPOINT: '',
      S3_ACCESS_KEY_ID: '',
      OPENROUTER_API_KEY: '',
      ENABLE_ANAMNESIS_WORKER: 'false',
    });
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('applies the schema timeout default when the passthrough is empty', async () => {
    const { readServerEnv } = await import('@/server/env');
    const env = readServerEnv({ ...baseEnv, ANAMNESIS_LLM_TIMEOUT_MS: '' });
    expect(env.ANAMNESIS_LLM_TIMEOUT_MS).toBe(120000);
  });

  it('refuses an S3 endpoint without credentials, defaults to fs storage', async () => {
    // Проверка живёт в фабрике хранилища (getObjectStorage), не в схеме env:
    // schema-слой оставляет endpoint необязательным полем.
    const { readServerEnv } = await import('@/server/env');
    const { getObjectStorage } = await import('@/server/storage');
    const globalStorage = globalThis as unknown as { objectStorage?: unknown };
    delete globalStorage.objectStorage;
    expect(() =>
      getObjectStorage(
        readServerEnv({ ...baseEnv, S3_ENDPOINT: 'http://s3.invalid:8333' }),
      ),
    ).toThrow(/S3_ENDPOINT requires/);
    delete globalStorage.objectStorage;
    const storage = getObjectStorage(readServerEnv(baseEnv));
    expect(typeof storage.put).toBe('function');
    expect(typeof storage.get).toBe('function');
    delete globalStorage.objectStorage;
  });
});
