import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
const state = vi.hoisted(() => ({
  database: undefined as ReturnType<typeof openDatabase> | undefined,
  getDatabase: vi.fn(),
  load: vi.fn(async () => null),
  source: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/db', () => ({
  getDatabase: () => {
    state.getDatabase();
    return state.database!;
  },
}));
vi.mock('@/server/yazio/token-store', () => ({
  fileTokenStore: () => ({ load: state.load, save: vi.fn() }),
}));
vi.mock('@/server/yazio/adapter', () => ({ nutritionUpstream: state.source }));
import {
  runNutritionSync,
  startNutritionScheduler,
  stopNutritionScheduler,
} from '@/server/jobs/nutrition-scheduler';
import { register } from '@/instrumentation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  state.database = openDatabase('file::memory:');
  migrate(state.database.db, { migrationsFolder: './drizzle' });
  state.database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic owner',
      role: 'OWNER',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('NEXT_PHASE', '');
  vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-fixture-only-auth-secret-12345');
  vi.stubEnv('BETTER_AUTH_URL', 'https://example.test');
  vi.stubEnv('YAZIO_TOKEN_FILE', '');
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'false');
});
afterEach(() => {
  stopNutritionScheduler();
  state.database!.sqlite.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('blocks private-path misconfiguration before token reads or client construction', async () => {
  for (const path of ['public/token.json', '.data/uploads/token.json']) {
    vi.stubEnv('YAZIO_TOKEN_FILE', path);
    await expect(
      runNutritionSync(
        'owner',
        { from: '2026-10-11', to: '2026-10-11' },
        { mode: 'manual' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  }
  expect(state.load).not.toHaveBeenCalled();
  expect(state.source).not.toHaveBeenCalled();
});
it('never invokes a client for unconfigured or disconnected encrypted-token storage', async () => {
  await expect(
    runNutritionSync(
      'owner',
      { from: '2026-10-11', to: '2026-10-11' },
      { mode: 'manual' },
    ),
  ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  expect(state.load).not.toHaveBeenCalled();
  vi.stubEnv('YAZIO_TOKEN_FILE', '.data/synthetic-encrypted-token.json');
  await expect(
    runNutritionSync(
      'owner',
      { from: '2026-10-11', to: '2026-10-11' },
      { mode: 'manual' },
    ),
  ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  expect(state.load).toHaveBeenCalledOnce();
  expect(state.source).not.toHaveBeenCalled();
});
it('registers one delayed timer in configured production without eager DB/token/upstream work', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'true');
  vi.stubEnv('YAZIO_TOKEN_FILE', '.data/synthetic-encrypted-token.json');
  await register();
  startNutritionScheduler();
  await register();
  expect(vi.getTimerCount()).toBe(1);
  expect(state.getDatabase).not.toHaveBeenCalled();
  expect(state.load).not.toHaveBeenCalled();
  expect(state.source).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  expect(state.load).toHaveBeenCalledOnce();
  expect(state.source).not.toHaveBeenCalled();
  stopNutritionScheduler();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not register during prerender/build, edge, dev or disabled feature', async () => {
  for (const mode of [
    {
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      NEXT_PHASE: 'phase-production-build',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    {
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'edge',
      NEXT_PHASE: '',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    {
      NODE_ENV: 'development',
      NEXT_RUNTIME: 'nodejs',
      NEXT_PHASE: '',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    {
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      NEXT_PHASE: '',
      ENABLE_NUTRITION_SCHEDULER: 'false',
    },
  ]) {
    for (const [key, value] of Object.entries(mode)) vi.stubEnv(key, value);
    await register();
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(state.getDatabase).not.toHaveBeenCalled();
  expect(state.load).not.toHaveBeenCalled();
});
