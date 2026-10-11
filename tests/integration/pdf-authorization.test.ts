import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { syntheticDay } from '../unit/reports/fixtures';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const { createReportHandler } = await import('@/server/pdf/http');
const source = {
  getNutritionDays: vi.fn(async () => [syntheticDay()]),
  listPhotos: async () => [],
  readPhoto: async () => {
    throw new Error('No photo');
  },
};
const handler = createReportHandler(() => source);
const request = (ownerId = 'owner') =>
  new Request(
    `http://localhost/api/reports?ownerId=${ownerId}&start=2026-10-10&end=2026-10-10&period=daily&format=html`,
  );
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
it('does not read data for anonymous/cross-owner/ungranted trainer requests', async () => {
  state.session = null;
  expect((await handler(request())).status).toBe(401);
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  expect((await handler(request('other'))).status).toBe(403);
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  expect((await handler(request())).status).toBe(403);
  expect(source.getNutritionDays).not.toHaveBeenCalled();
});
it('exports private HTML for granted trainer and immediately denies a revoked grant', async () => {
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  const result = await handler(request());
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(result.headers.get('content-security-policy')).toContain('sandbox');
  expect(await result.text()).toContain('Яйцо');
  database.db.delete(trainerAccess).run();
  expect((await handler(request())).status).toBe(403);
});
it('rechecks grant after data generation and refuses to release bytes after mid-flight revocation', async () => {
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  const revoked = createReportHandler(() => ({
    ...source,
    getNutritionDays: async () => {
      database.db.delete(trainerAccess).run();
      return [syntheticDay()];
    },
  }));
  expect((await revoked(request())).status).toBe(403);
});
it('reports disconnected source meaningfully without exposing errors or secrets', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const response = await createReportHandler()(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('ещё не подключён');
});
