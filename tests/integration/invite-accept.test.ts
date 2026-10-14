import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { user, account } from '@/server/db/schema';
import { trainerInvitations } from '@/server/db/schema/trainer-invitations';
vi.mock('server-only', () => ({}));
const dir = mkdtempSync(join(tmpdir(), 'invite-accept-'));
const url = 'file:' + join(dir, 'test.sqlite');
const database = openDatabase(url);
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
import { getAuth } from '@/server/auth';
import { createInvitation } from '@/server/access/trainers';
import { POST } from '@/app/api/trainers/invitations/accept/route';
let headers: Headers;
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'invite-only-synthetic-secret-at-least-32-characters',
  );
  migrate(database.db, { migrationsFolder: './drizzle' });
  const now = new Date();
  database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic owner',
      email: 'owner@example.test',
      role: 'OWNER',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  database.db
    .insert(account)
    .values({
      id: 'owner-account',
      accountId: 'owner',
      providerId: 'credential',
      userId: 'owner',
      password: await hashPassword('abcdefghijkl'),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const response = await getAuth().api.signInEmail({
    body: { email: 'owner@example.test', password: 'abcdefghijkl' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  headers = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  database.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
let counter = 0;
async function invite(email = `synthetic-${counter++}@example.test`) {
  return createInvitation(headers, { ownerId: 'owner', email });
}
function accept(
  token: string,
  password: string,
  origin = 'http://localhost:3000',
) {
  return POST(
    new Request('http://internal:3000/api/trainers/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ token, name: 'Synthetic trainer', password }),
    }),
  );
}
const consumed = (token: string) =>
  database.db
    .select()
    .from(trainerInvitations)
    .all()
    .find((row) => row.tokenHash === requireHash(token))?.consumedAt;
import { createHash } from 'node:crypto';
const requireHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
it('7 rejects before consumption; 8 and 12 ASCII characters create actual TRAINER credentials and sign in', async () => {
  for (const password of ['abcdefgh', 'abcdefghijkl']) {
    const email = `password-${password.length}@example.test`;
    const invitation = await invite(email);
    const short = await accept(invitation.token, 'abcdefg');
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: 'INVITE_INVALID_INPUT' });
    expect(consumed(invitation.token)).toBeNull();
    const response = await accept(invitation.token, password);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    const signed = await getAuth().api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(signed.status).toBe(200);
    expect((await signed.json()).user.role).toBe('TRAINER');
    const replay = await accept(invitation.token, password);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: 'INVITE_UNAVAILABLE' });
  }
});
it('expired/invalid capability is unavailable; existing account rollback leaves the token usable', async () => {
  const expired = await invite();
  database.db
    .update(trainerInvitations)
    .set({ expiresAt: 0 })
    .where(eq(trainerInvitations.tokenHash, requireHash(expired.token)))
    .run();
  for (const token of [expired.token, 'a'.repeat(64)]) {
    const response = await accept(token, 'abcdefgh');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVITE_UNAVAILABLE' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
  const duplicate = await invite('password-8@example.test');
  const response = await accept(duplicate.token, 'abcdefgh');
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'INVITE_ACCOUNT_EXISTS' });
  expect(consumed(duplicate.token)).toBeNull();
  database.db
    .delete(user)
    .where(eq(user.email, 'password-8@example.test'))
    .run();
  expect((await accept(duplicate.token, 'abcdefgh')).status).toBe(200);
});
it('trusted public Origin works through internal URL; foreign Origin and unexpected failure do not consume', async () => {
  const invitation = await invite();
  const denied = await accept(
    invitation.token,
    'abcdefgh',
    'https://attacker.example.test',
  );
  expect(denied.status).toBe(403);
  expect(consumed(invitation.token)).toBeNull();
  const transaction = vi
    .spyOn(database.db, 'transaction')
    .mockImplementation(() => {
      throw new Error('SYNTHETIC_PRIVATE_FAILURE');
    });
  const failure = await accept(invitation.token, 'abcdefgh');
  expect(failure.status).toBe(500);
  expect(await failure.json()).toEqual({ error: 'request_failed' });
  expect(failure.headers.get('cache-control')).toBe('no-store');
  expect(consumed(invitation.token)).toBeNull();
  transaction.mockRestore();
  expect((await accept(invitation.token, 'abcdefgh')).status).toBe(200);
});
it('parallel accepts preserve one-use CAS and only one created account', async () => {
  const invitation = await invite();
  const responses = await Promise.all([
    accept(invitation.token, 'abcdefgh'),
    accept(invitation.token, 'abcdefgh'),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
});
// Three sequential CLI startups plus real password hashing need their own CI budget.
it(
  'CLI shares 7 reject/8 accept/12 accept validation and compatible real credentials',
  { timeout: 30000 },
  async () => {
    for (const password of ['abcdefg', 'abcdefgh', 'abcdefghijkl']) {
      const email = `cli-${password.length}@example.test`;
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/create-user.ts'],
        {
          env: {
            ...process.env,
            DATABASE_URL: url,
            CREATE_USER_EMAIL: email,
            CREATE_USER_NAME: 'Synthetic CLI',
            CREATE_USER_ROLE: 'TRAINER',
            CREATE_USER_PASSWORD: password,
          },
          encoding: 'utf8',
        },
      );
      expect(result.status).toBe(password.length === 7 ? 1 : 0);
      if (password.length === 7)
        expect(
          database.db.select().from(user).where(eq(user.email, email)).get(),
        ).toBeUndefined();
      else
        expect(
          (
            await getAuth().api.signInEmail({
              body: { email, password },
              asResponse: true,
            })
          ).status,
        ).toBe(200);
    }
  },
);
