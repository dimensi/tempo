import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const { getAccessibleOwnerId } = await import('@/server/access/owner');

beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
    ['other-trainer', 'TRAINER'],
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

it('selects only the signed-in owner and fails closed for absent or unknown roles', async () => {
  state.session = null;
  expect(await getAccessibleOwnerId(new Headers())).toBeNull();
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  expect(await getAccessibleOwnerId(new Headers())).toBe('owner');
  state.session = { user: { id: 'owner', role: 'ADMIN' } };
  expect(await getAccessibleOwnerId(new Headers())).toBeNull();
});

it('selects only the current trainer grant and immediately observes revocation', async () => {
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  database.db
    .insert(trainerAccess)
    .values({
      trainerId: 'other-trainer',
      ownerId: 'owner',
      createdAt: new Date(),
    })
    .run();
  expect(await getAccessibleOwnerId(new Headers())).toBeNull();
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  expect(await getAccessibleOwnerId(new Headers())).toBe('owner');
  database.db
    .delete(trainerAccess)
    .where(eq(trainerAccess.trainerId, 'trainer'))
    .run();
  expect(await getAccessibleOwnerId(new Headers())).toBeNull();
});
