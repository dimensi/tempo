import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { user, account, trainerAccess } from '@/server/db/schema';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
import { getAuth } from '@/server/auth';
import { GET, PUT } from '@/app/api/settings/steps-goal/route';
import { getReportStepsGoal } from '@/server/settings/steps-goal';
let ownerHeaders: Headers;
let trainerHeaders: Headers;
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'health-test-synthetic-secret-123456789012345',
  );
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const) {
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
    database.db
      .insert(account)
      .values({
        id: `credential-${id}`,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword('Health-test-password-12345'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const response = await getAuth().api.signInEmail({
      body: {
        email: `${id}@example.test`,
        password: 'Health-test-password-12345',
      },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const headers = new Headers({ cookie });
    if (id === 'owner') ownerHeaders = headers;
    else trainerHeaders = headers;
  }
});
afterAll(() => {
  database.sqlite.close();
  vi.unstubAllEnvs();
});
const request = (
  method: 'GET' | 'PUT',
  headers: Headers,
  value?: unknown,
  origin = 'http://localhost:3000',
) => {
  const next = new Headers(headers);
  next.set('origin', origin);
  return (method === 'GET' ? GET : PUT)(
    new Request('http://localhost:3000/api/settings/steps-goal', {
      method,
      headers: next,
      ...(method === 'PUT' ? { body: JSON.stringify(value) } : {}),
    }),
  );
};
it('defaults to no goal; persists edits and disabling; permits safe integers only', async () => {
  expect(await (await request('GET', ownerHeaders)).json()).toEqual({
    dailyStepsGoal: null,
  });
  for (const goal of [10000, 7500, Number.MAX_SAFE_INTEGER, null]) {
    const response = await request('PUT', ownerHeaders, {
      dailyStepsGoal: goal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await (await request('GET', ownerHeaders)).json()).toEqual({
      dailyStepsGoal: goal,
    });
  }
  for (const goal of [0, -1, 1.5, '', '10000', Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      (await request('PUT', ownerHeaders, { dailyStepsGoal: goal })).status,
    ).toBe(400);
  }
  expect(
    (
      await request('PUT', ownerHeaders, {
        dailyStepsGoal: 10000,
        ownerId: 'trainer',
      })
    ).status,
  ).toBe(400);
  expect(await (await request('GET', ownerHeaders)).json()).toEqual({
    dailyStepsGoal: null,
  });
  expect(() =>
    database.sqlite
      .prepare('UPDATE owner_settings SET daily_steps_goal=0')
      .run(),
  ).toThrow();
});
it('enforces real sessions, owner-only settings, trusted origin and scoped report grants', async () => {
  expect((await request('GET', new Headers())).status).toBe(401);
  expect(
    (await request('PUT', new Headers(), { dailyStepsGoal: 1 })).status,
  ).toBe(401);
  for (const method of ['GET', 'PUT'] as const) {
    expect(
      (await request(method, trainerHeaders, { dailyStepsGoal: 1 })).status,
    ).toBe(403);
  }
  expect(
    (
      await request(
        'PUT',
        ownerHeaders,
        { dailyStepsGoal: 1 },
        'https://foreign.test',
      )
    ).status,
  ).toBe(403);
  await request('PUT', ownerHeaders, { dailyStepsGoal: 12345 });
  await expect(
    getReportStepsGoal(ownerHeaders, 'trainer'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    getReportStepsGoal(trainerHeaders, 'owner'),
  ).rejects.toMatchObject({ status: 403 });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  expect(await getReportStepsGoal(trainerHeaders, 'owner')).toBe(12345);
  expect(
    (await request('PUT', trainerHeaders, { dailyStepsGoal: 1 })).status,
  ).toBe(403);
  database.db.delete(trainerAccess).run();
  await expect(
    getReportStepsGoal(trainerHeaders, 'owner'),
  ).rejects.toMatchObject({ status: 403 });
});
