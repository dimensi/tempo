import type { Token } from '@dimensi/yazio/auth';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { openDatabase } from '@/server/db/connection';
import { user, account, session, trainerAccess } from '@/server/db/schema';

const synthetic = vi.hoisted(() => ({
  exchange: vi.fn(),
  profile: vi.fn(),
  upstream: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  run: vi.fn(),
  schedule: vi.fn(() => ({
    enabled: false,
    schedulerActive: false,
    timezone: 'UTC',
    initialFrom: null,
    lastSuccess: null,
    lastError: null,
    nextRunAt: null,
    attempt: 0,
    running: false,
  })),
  save: vi.fn(async () => {}),
  load: vi.fn(async (): Promise<Token | null> => null),
  disconnect: vi.fn(async () => {}),
}));
vi.mock('@/server/jobs/nutrition-scheduler', () => ({
  enableNutritionSchedule: synthetic.enable,
  disableNutritionSchedule: synthetic.disable,
  getNutritionSchedule: synthetic.schedule,
  runNutritionSync: synthetic.run,
}));
vi.mock('server-only', () => ({}));
vi.mock('@dimensi/yazio/api', () => ({
  getTokenFromCredentials: synthetic.exchange,
  getUser: synthetic.profile,
}));
vi.mock('@/server/yazio/adapter', () => ({
  nutritionUpstream: synthetic.upstream,
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
const scheduleInput = {
  timezone: 'UTC',
  initialFrom: shiftDate(dateInTimezone(new Date()), -6),
};
const input = {
  ...scheduleInput,
  email: 'synthetic-yazio@example.test',
  password: 'Synthetic-YAZIO-password-only',
};
const origin = 'http://localhost:3135';
let ownerHeaders: Headers;
let trainerHeaders: Headers;
const { getAuth } = await import('@/server/auth');
const { POST } = await import('@/app/api/yazio/connect/route');
const { POST: disconnect } = await import('@/app/api/yazio/disconnect/route');
const { POST: sync } = await import('@/app/api/yazio/sync/route');
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
  synthetic.enable.mockClear();
  synthetic.disable.mockClear();
  synthetic.run.mockReset().mockResolvedValue({
    state: 'completed',
    startedAt: null,
    finishedAt: null,
    completedDates: [],
    failedDates: [],
    photoFailedDates: [],
  });
  synthetic.profile.mockReset().mockResolvedValue({
    email: 'actual-yazio@example.test',
    first_name: 'YAZIO',
    last_name: 'Profile',
    profile_image: 'https://images.yazio-cdn.com/avatar.png?private=secret',
    user_token: 'private-user-token',
  });
  synthetic.schedule.mockClear();
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
it('real OWNER session exchanges via SDK and awaits saving only a full token; response has only safe YAZIO account metadata', async () => {
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
  expect(synthetic.enable).not.toHaveBeenCalled();
  release();
  const response = await pending;
  expect(response.status).toBe(200);
  const responseBody = await response.json();
  expect(responseBody).toMatchObject({
    configured: true,
    account: {
      email: 'actual-yazio@example.test',
      name: 'YAZIO Profile',
      avatar: 'https://images.yazio-cdn.com/avatar.png',
    },
  });
  expect(JSON.stringify(responseBody)).not.toContain('private-user-token');
  expect(JSON.stringify(responseBody)).not.toContain('secret');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(synthetic.exchange).toHaveBeenCalledWith({
    username: input.email,
    password: input.password,
  });
  expect(synthetic.save).toHaveBeenCalledWith(token);
  expect(synthetic.enable).toHaveBeenCalledWith(
    'connection-owner',
    expect.objectContaining({ timezone: 'UTC' }),
  );
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
it('connect/import use button intent and reject obsolete confirmation fields; disconnect still confirms', async () => {
  expect((await POST(request(ownerHeaders, input))).status).toBe(200);
  expect(
    (await importToken(request(ownerHeaders, { token, ...scheduleInput })))
      .status,
  ).toBe(200);
  for (const confirmed of [false, true]) {
    expect(
      (await POST(request(ownerHeaders, { ...input, confirmed }))).status,
    ).toBe(400);
    expect(
      (
        await importToken(
          request(ownerHeaders, { token, ...scheduleInput, confirmed }),
        )
      ).status,
    ).toBe(400);
  }
  synthetic.disable.mockClear();
  synthetic.disconnect.mockClear();
  for (const confirmed of [undefined, false])
    expect(
      (await disconnect(request(ownerHeaders, { confirmed }))).status,
    ).toBe(400);
  expect(synthetic.disable).not.toHaveBeenCalled();
  expect(synthetic.disconnect).not.toHaveBeenCalled();
});
it('accepts advanced confirmed token import and persists only validated token fields', async () => {
  const response = await importToken(
    request(ownerHeaders, { token: { ...token, ...input }, ...scheduleInput }),
  );
  expect(response.status).toBe(200);
  const responseBody = await response.json();
  expect(responseBody).toMatchObject({
    configured: true,
    account: {
      email: 'actual-yazio@example.test',
      name: 'YAZIO Profile',
      avatar: 'https://images.yazio-cdn.com/avatar.png',
    },
  });
  expect(JSON.stringify(responseBody)).not.toContain('private-user-token');
  expect(JSON.stringify(responseBody)).not.toContain('secret');
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
  expect(synthetic.disable).not.toHaveBeenCalled();
  database.db
    .update(user)
    .set({ role: 'OWNER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
});
it.each([
  { mode: 'period', from: '9999-12-31' },
  { mode: 'period', from: '2026-01-01', to: '9999-12-31' },
  { mode: 'recent', days: 7, through: '9999-12-31' },
  { mode: 'period', from: '2026-01-02', to: '2026-01-01' },
  { mode: 'period', from: '2026-01-01', timezone: 'Bad/Timezone' },
])(
  'rejects invalid sync before SDK preparation with real owner session %j',
  async (body) => {
    expect((await sync(request(ownerHeaders, body))).status).toBe(400);
    expect(synthetic.upstream).not.toHaveBeenCalled();
    expect(synthetic.run).not.toHaveBeenCalled();
    expect(synthetic.load).not.toHaveBeenCalled();
  },
);

it('validates connection schedule before credentials or storage access', async () => {
  for (const metadata of [
    { timezone: 'Invalid/Zone' },
    { initialFrom: '9999-12-31' },
    { initialFrom: '2020-01-01' },
  ]) {
    expect(
      (await POST(request(ownerHeaders, { ...input, ...metadata }))).status,
    ).toBe(400);
    expect(
      (
        await importToken(
          request(ownerHeaders, { token, ...scheduleInput, ...metadata }),
        )
      ).status,
    ).toBe(400);
  }
  expect(synthetic.exchange).not.toHaveBeenCalled();
  expect(synthetic.load).not.toHaveBeenCalled();
  expect(synthetic.enable).not.toHaveBeenCalled();
});
it('confirmed disconnect invalidates schedule before awaited token removal', async () => {
  let release!: () => void;
  synthetic.disconnect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const pending = disconnect(request(ownerHeaders, { confirmed: true }));
  await vi.waitFor(() => expect(synthetic.disconnect).toHaveBeenCalledTimes(1));
  expect(synthetic.disable).toHaveBeenCalledWith('connection-owner');
  expect(synthetic.disable.mock.invocationCallOrder[0]).toBeLessThan(
    synthetic.disconnect.mock.invocationCallOrder[0]!,
  );
  release();
  expect((await pending).status).toBe(200);
});
it('manual sync uses common lease service and preserves caller timezone', async () => {
  synthetic.run.mockResolvedValue({
    state: 'completed',
    completedDates: ['2026-01-01'],
    failedDates: [],
    photoFailedDates: [],
    startedAt: null,
    finishedAt: null,
  });
  expect(
    (
      await sync(
        request(ownerHeaders, {
          mode: 'period',
          from: '2026-01-01',
          to: '2026-01-01',
          timezone: 'Europe/Moscow',
        }),
      )
    ).status,
  ).toBe(200);
  expect(synthetic.run).toHaveBeenCalledWith(
    'connection-owner',
    { from: '2026-01-01', to: '2026-01-01' },
    { mode: 'manual', timezone: 'Europe/Moscow' },
  );
  expect(synthetic.upstream).not.toHaveBeenCalled();
});
it('revalidates real owner permission after server backfill before returning account data', async () => {
  let release!: (value: unknown) => void;
  synthetic.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = POST(request(ownerHeaders));
  await vi.waitFor(() => expect(synthetic.run).toHaveBeenCalledTimes(1));
  database.db
    .update(user)
    .set({ role: 'TRAINER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
  release({
    state: 'completed',
    startedAt: null,
    finishedAt: null,
    completedDates: [],
    failedDates: [],
    photoFailedDates: [],
  });
  expect((await pending).status).toBe(403);
  database.db
    .update(user)
    .set({ role: 'OWNER' })
    .where(eq(user.id, 'connection-owner'))
    .run();
});
it('an existing connection gets safe profile metadata without another credential exchange', async () => {
  const { clearYazioAccount, getYazioAccount } =
    await import('@/server/yazio/account');
  const { refreshYazioAccount } = await import('@/server/yazio/settings');
  clearYazioAccount('connection-owner');
  const enabled = { ...synthetic.schedule(), enabled: true };
  synthetic.schedule.mockReturnValueOnce(enabled).mockReturnValueOnce(enabled);
  synthetic.load.mockResolvedValueOnce(token);
  await refreshYazioAccount(ownerHeaders);
  expect(synthetic.exchange).not.toHaveBeenCalled();
  expect(synthetic.profile).toHaveBeenCalledWith(token);
  expect(getYazioAccount('connection-owner')).toEqual({
    email: 'actual-yazio@example.test',
    name: 'YAZIO Profile',
    avatar: 'https://images.yazio-cdn.com/avatar.png',
  });
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
