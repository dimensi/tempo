import { GET as analyticsGET } from '@/app/api/read/analytics/route';
import { GET as contextGET } from '@/app/api/read/context/route';
import { GET as settingsGET } from '@/app/api/read/settings/route';
import { GET as workoutGET } from '@/app/api/read/workout/route';
import { getAuth } from '@/server/auth';
import { openDatabase } from '@/server/db/connection';
import { account, trainerAccess, user } from '@/server/db/schema';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
let owner: Headers, trainer: Headers;
async function login(id: string) {
  const response = await getAuth().api.signInEmail({
    body: { email: id + '@example.test', password: 'Synthetic-password-12345' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  });
}
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'read-test-synthetic-secret-at-least-32-characters',
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
        name: 'Synthetic',
        email: id + '@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    database.db
      .insert(account)
      .values({
        id: 'credential-' + id,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword('Synthetic-password-12345'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }
  owner = await login('owner');
  trainer = await login('trainer');
});
afterAll(() => {
  database.sqlite.close();
  vi.unstubAllEnvs();
});
const cases = [
  ['/api/read/context', contextGET],
  ['/api/read/workout?kind=session&id=missing&date=2026-10-16', workoutGET],
  [
    '/api/read/analytics?from=2026-10-10&to=2026-10-16&timezone=UTC',
    analyticsGET,
  ],
  ['/api/read/settings', settingsGET],
] as const;
it.each(cases)(
  'denies anonymous %s with a machine-readable auth failure',
  async (path, handler) => {
    const response = await handler(new Request('http://localhost:3000' + path));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
  },
);
it.each(cases)('denies an ungranted trainer at %s', async (path, handler) => {
  const response = await handler(
    new Request('http://localhost:3000' + path, { headers: trainer }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'ACCESS_REVOKED' });
});
it('returns a stable account context without device/grant generation', async () => {
  const response = await contextGET(
    new Request('http://localhost:3000/api/read/context', { headers: owner }),
  );
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value).toMatchObject({
    readerId: 'owner',
    ownerId: 'owner',
    role: 'OWNER',
  });
  expect(value.partition).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(value).not.toHaveProperty('connectionGeneration');
});
it('a resource/action restriction does not become global grant revocation', async () => {
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  try {
    const response = await settingsGET(
      new Request('http://localhost:3000/api/read/settings', {
        headers: trainer,
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'FORBIDDEN' });
    expect(
      (
        await contextGET(
          new Request('http://localhost:3000/api/read/context', {
            headers: trainer,
          }),
        )
      ).status,
    ).toBe(200);
  } finally {
    database.db
      .delete(trainerAccess)
      .where(eq(trainerAccess.trainerId, 'trainer'))
      .run();
  }
});
