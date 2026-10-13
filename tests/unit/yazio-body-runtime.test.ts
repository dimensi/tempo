import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  database: null as ReturnType<
    typeof import('@/server/db/connection').openDatabase
  > | null,
  loaded: false,
  reads: 0,
  source: vi.fn(),
}));
vi.mock('@/server/db', () => ({ getDatabase: () => state.database }));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    YAZIO_TOKEN_FILE: '/tmp/synthetic-yazio-body-runtime.json',
    BETTER_AUTH_SECRET: 'synthetic-body-runtime-secret-only',
    UPLOADS_DIR: '/tmp/synthetic-body-uploads',
  }),
}));
vi.mock('@/server/yazio/token-store', () => ({
  fileTokenStore: () => ({
    load: async () => {
      state.loaded = true;
      state.reads++;
      return {};
    },
    save: async () => {},
    assertCurrent: async () => {
      if (!state.loaded) throw new Error('Not loaded');
    },
  }),
}));
vi.mock('@/server/yazio/body-adapter', () => ({ bodyUpstream: state.source }));
import { openDatabase } from '@/server/db/connection';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { user } from '@/server/db/schema';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { measurementRepository } from '@/server/measurements/repository';
import { bodyRepository } from '@/server/yazio/body-repository';
import { runBodySync } from '@/server/yazio/body-runtime';
beforeEach(() => {
  state.loaded = false;
  state.reads = 0;
  state.source.mockReset();
  state.database = openDatabase('file::memory:');
  migrate(state.database.db, { migrationsFolder: './drizzle' });
  state.database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic',
      email: 'runtime@example.test',
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  state.database.db
    .insert(nutritionSchedule)
    .values({ ownerId: 'owner', enabled: true, epoch: 1 })
    .run();
});
afterEach(() => state.database?.sqlite.close());
it('loads a fresh store before asserting its token fence and retains new date work while active', async () => {
  let release!: () => void;
  const summary = vi.fn(async (date: string) => {
    if (date === '2026-10-12')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {};
  });
  state.source.mockImplementation(async (store) => {
    await store.load();
    await store.assertCurrent();
    return { summary };
  });
  const first = runBodySync('owner', ['2026-10-12'], undefined, 1);
  await vi.waitFor(() => expect(release).toBeDefined());
  const second = runBodySync('owner', ['2026-10-13'], undefined, 1);
  expect(second).toBe(first);
  release();
  await first;
  expect(summary.mock.calls.map((c) => c[0])).toEqual([
    '2026-10-12',
    '2026-10-13',
  ]);
  expect(state.reads).toBe(2);
});
it('never adopts a replaced connection epoch for deferred old food-sync work', async () => {
  state.database!.db.update(nutritionSchedule).set({ epoch: 2 }).run();
  await runBodySync('owner', ['2026-10-13'], undefined, 1);
  expect(state.source).not.toHaveBeenCalled();
  expect(state.reads).toBe(0);
});
it('constructor/storage failure marks queued local saves failed with backoff instead of leaving pending forever', async () => {
  const db = state.database!,
    repo = bodyRepository(db),
    input = {
      measuredAt: '2026-10-13',
      note: null,
      values: [{ metric: 'weight' as const, value: '80', unit: 'kg' as const }],
    };
  const record = measurementRepository(db.db).create('owner', input);
  repo.enqueue('owner', record.id, input, null);
  state.source.mockRejectedValueOnce(new Error('Synthetic unavailable'));
  await runBodySync('owner');
  expect(repo.status('owner', record.id)[0]?.state).toBe('failed');
  expect(repo.due('owner', 1)).toEqual([]);
});
