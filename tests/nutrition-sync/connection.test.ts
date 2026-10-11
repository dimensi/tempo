import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { openDatabase } from '@/server/db/connection';
import { user, account, session, trainerAccess } from '@/server/db/schema';

const synthetic = vi.hoisted(() => ({
  exchange: vi.fn(),
  save: vi.fn(async () => {}),
  load: vi.fn(async (): Promise<null> => null),
  disconnect: vi.fn(async () => {}),
}));
vi.mock('server-only', () => ({}));
vi.mock('@dimensi/yazio/api', () => ({
  getTokenFromCredentials: synthetic.exchange,
}));
vi.mock('@/server/yazio/token-store', () => ({
  fileTokenStore: () => ({
    load: synthetic.load,
    save: synthetic.save,
    disconnect: synthetic.disconnect,
  }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const token = {
  token_type: 'Bearer',
  access_token: 'synthetic-access-only',
  refresh_token: 'synthetic-refresh-only',
  expires_in: 3600,
  expires_at: 9999999999999,
};
const input = {
  email: 'synthetic-yazio@example.test',
  password: 'Synthetic-YAZIO-password-only',
  confirmed: true,
};
const origin = 'http://localhost:3135';
let ownerHeaders: Headers;
let trainerHeaders: Headers;
const { getAuth } = await import('@/server/auth');
const { POST } = await import('@/app/api/yazio/connect/route');
const { POST: disconnect } = await import('@/app/api/yazio/disconnect/route');
const { POST: importToken } = await import('@/app/api/yazio/token/route');
beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv(
    'BETTER_AUTH_SECRET',
    'synthetic-connection-auth-secret-not-production-12345',
  );
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['connection-owner', 'OWNER'],
    ['connection-trainer', 'TRAINER'],
  ] as const) {
    database.db
      .insert(user)
      .values({
        id,
        role,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    database.db
      .insert(account)
      .values({
        id,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: await hashPassword('Synthetic-app-password-12345'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const response = await getAuth().api.signInEmail({
      body: {
        email: `${id}@example.test`,
        password: 'Synthetic-app-password-12345',
      },
      headers: new Headers({ origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(cookie).toContain('session_token');
    const headers = new Headers({ origin, cookie });
    if (role === 'OWNER') ownerHeaders = headers;
    else trainerHeaders = headers;
  }
});
beforeEach(() => {
  synthetic.exchange.mockReset().mockResolvedValue(token);
  synthetic.save.mockClear();
  synthetic.load.mockReset().mockResolvedValue(null);
  synthetic.disconnect.mockClear();
  vi.stubEnv(
    'YAZIO_TOKEN_FILE',
    '/private/tmp/synthetic-connection-token.json',
  );
});
afterAll(() => {
  vi.unstubAllEnvs();
  database.sqlite.close();
});
function request(headers: Headers, body: unknown = input) {
  return new Request(origin + '/api/yazio/connect', {
    method: 'POST',
    headers: new Headers([...headers, ['content-type', 'application/json']]),
    body: JSON.stringify(body),
  });
}
it('real OWNER session exchanges via SDK and awaits saving only a full token; response has no credentials', async () => {
  synthetic.exchange.mockResolvedValue({ ...token, ...input });
  let release!: () => void;
  synthetic.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let completed = false;
  const pending = POST(request(ownerHeaders)).then((response) => {
    completed = true;
    return response;
  });
  await vi.waitFor(() => expect(synthetic.save).toHaveBeenCalledTimes(1));
  expect(completed).toBe(false);
  release();
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ configured: true });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(synthetic.exchange).toHaveBeenCalledWith({
    username: input.email,
    password: input.password,
  });
  expect(synthetic.save).toHaveBeenCalledWith(token);
});
it('denies anonymous and real TRAINER sessions even with grant, before exchange or save', async () => {
  expect((await POST(request(new Headers({ origin })))).status).toBe(401);
  database.db
    .insert(trainerAccess)
    .values({
      trainerId: 'connection-trainer',
      ownerId: 'connection-owner',
      createdAt: new Date(),
    })
    .run();
  expect((await POST(request(trainerHeaders))).status).toBe(403);
  database.db.delete(trainerAccess).run();
  expect(synthetic.exchange).not.toHaveBeenCalled();
  expect(synthetic.save).not.toHaveBeenCalled();
});
it('rejects wrong Origin, bounded malformed input, and absent storage before upstream exchange', async () => {
  const wrongOrigin = new Headers(ownerHeaders);
  wrongOrigin.set('origin', 'https://evil.example.test');
  expect((await POST(request(wrongOrigin))).status).toBe(403);
  expect(
    (
      await POST(
        request(ownerHeaders, { ...input, password: 'x'.repeat(9000) }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(request(ownerHeaders, { email: 'invalid', password: 'x' })))
      .status,
  ).toBe(400);
  vi.stubEnv('YAZIO_TOKEN_FILE', '');
  expect((await POST(request(ownerHeaders))).status).toBe(503);
  expect(synthetic.exchange).not.toHaveBeenCalled();
  expect(synthetic.save).not.toHaveBeenCalled();
});
it('requires literal confirmation for connect/import/disconnect before upstream or store operations', async () => {
  for (const confirmed of [undefined, false]) {
    expect(
      (await POST(request(ownerHeaders, { ...input, confirmed }))).status,
    ).toBe(400);
    expect(
      (await importToken(request(ownerHeaders, { token, confirmed }))).status,
    ).toBe(400);
    expect(
      (await disconnect(request(ownerHeaders, { confirmed }))).status,
    ).toBe(400);
  }
  expect(synthetic.exchange).not.toHaveBeenCalled();
  expect(synthetic.load).not.toHaveBeenCalled();
  expect(synthetic.save).not.toHaveBeenCalled();
  expect(synthetic.disconnect).not.toHaveBeenCalled();
});
it('accepts advanced confirmed token import and persists only validated token fields', async () => {
  const response = await importToken(
    request(ownerHeaders, { token: { ...token, ...input }, confirmed: true }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ configured: true });
  expect(synthetic.save).toHaveBeenCalledWith(token);
  expect(synthetic.exchange).not.toHaveBeenCalled();
});
it('sanitizes upstream and save errors, and never returns email/password/token or writes on exchange failure', async () => {
  const secrets = JSON.stringify({ ...input, ...token });
  synthetic.exchange.mockRejectedValueOnce(new Error(secrets));
  const response = await POST(request(ownerHeaders));
  expect(response.status).toBe(502);
  const output = await response.text();
  for (const value of [
    input.email,
    input.password,
    token.access_token,
    token.refresh_token,
  ])
    expect(output).not.toContain(value);
  expect(synthetic.save).not.toHaveBeenCalled();
  synthetic.save.mockRejectedValueOnce(new Error(secrets));
  expect(await (await POST(request(ownerHeaders))).json()).toEqual({
    error: 'Не удалось выполнить запрос',
  });
});
it('times out exchange without persisting late tokens', async () => {
  let release!: (value: typeof token) => void;
  synthetic.exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pending = POST(request(ownerHeaders));
    await vi.waitFor(() => expect(synthetic.exchange).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30000);
    expect((await pending).status).toBe(502);
    release(token);
    await Promise.resolve();
    expect(synthetic.save).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it('rejects a real owner role revoked during delayed exchange, without persisting the token', async () => {
  let release!: (value: typeof token) => void;
  synthetic.exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = POST(request(ownerHeaders));
  await vi.waitFor(() => expect(synthetic.exchange).toHaveBeenCalledTimes(1));
  database.db
    .update(user)
    .set({ role: 'TRAINER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
  release(token);
  expect((await pending).status).toBe(403);
  expect(synthetic.save).not.toHaveBeenCalled();
  database.db
    .update(user)
    .set({ role: 'OWNER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
});
it('rechecks OWNER permissions after asynchronous disconnect preparation', async () => {
  let release!: () => void;
  synthetic.load.mockImplementationOnce(
    () =>
      new Promise<null>((resolve) => {
        release = () => resolve(null);
      }),
  );
  const pending = disconnect(request(ownerHeaders, { confirmed: true }));
  await vi.waitFor(() => expect(synthetic.load).toHaveBeenCalledTimes(1));
  database.db
    .update(user)
    .set({ role: 'TRAINER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
  release();
  expect((await pending).status).toBe(403);
  expect(synthetic.disconnect).not.toHaveBeenCalled();
  database.db
    .update(user)
    .set({ role: 'OWNER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
});
it('rejects a real session revoked during delayed exchange before persistence', async () => {
  let release!: (value: typeof token) => void;
  synthetic.exchange.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = POST(request(ownerHeaders));
  await vi.waitFor(() => expect(synthetic.exchange).toHaveBeenCalledTimes(1));
  database.db
    .delete(session)
    .where(eq(session.userId, 'connection-owner'))
    .run();
  release(token);
  expect((await pending).status).toBe(401);
  expect(synthetic.save).not.toHaveBeenCalled();
});
