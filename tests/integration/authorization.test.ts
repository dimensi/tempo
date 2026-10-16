import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { trainerAccess, user } from '@/server/db/schema';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));

const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const { authorize } = await import('@/server/auth/guards');

beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const)
    database.db
      .insert(user)
      .values({
        id,
        role,
        name: id,
        email: `${id}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
});
afterAll(() => database.sqlite.close());

it('fails closed for missing/foreign owners and requires a live trainer grant', async () => {
  state.session = null;
  expect(await authorize(new Headers(), 'nutrition:read', 'owner')).toEqual({
    ok: false,
    status: 401,
  });

  state.session = { user: { id: 'owner', role: 'OWNER' } };
  expect(await authorize(new Headers(), 'nutrition:read')).toEqual({
    ok: false,
    status: 403,
  });
  expect(
    await authorize(new Headers(), 'nutrition:read', 'another-owner'),
  ).toEqual({ ok: false, status: 403 });
  expect((await authorize(new Headers(), 'nutrition:read', 'owner')).ok).toBe(
    true,
  );

  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  expect(await authorize(new Headers(), 'nutrition:read', 'owner')).toEqual({
    ok: false,
    status: 403,
  });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  expect((await authorize(new Headers(), 'nutrition:read', 'owner')).ok).toBe(
    true,
  );
  expect(await authorize(new Headers(), 'nutrition:write', 'owner')).toEqual({
    ok: false,
    status: 403,
  });
  database.db.delete(trainerAccess).run();
  expect(await authorize(new Headers(), 'nutrition:read', 'owner')).toEqual({
    ok: false,
    status: 403,
  });
});
