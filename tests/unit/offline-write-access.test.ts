import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorize: vi.fn(),
  catalog: vi.fn(),
  apply: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: mocks.session } }),
}));
vi.mock('@/server/auth/guards', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    BETTER_AUTH_SECRET: 'synthetic-unit-secret',
    BETTER_AUTH_URL: 'https://app.example.test',
  }),
}));
vi.mock('@/server/offline/write-repository', () => ({
  OfflineWriteError: class extends Error {
    constructor(public status: number) {
      super('write failed');
    }
  },
  offlineWriteRepository: () => ({
    catalog: mocks.catalog,
    apply: mocks.apply,
  }),
}));
vi.mock('@/server/yazio/body-repository', () => ({
  bodyRepository: () => ({ schedule: () => null }),
}));
vi.mock('@/server/yazio/body-runtime', () => ({ runBodySync: mocks.sync }));
import { createHmac } from 'node:crypto';
import {
  readOfflineWrites,
  saveOfflineWrite,
  offlineWriteResponse,
} from '@/server/offline/writes';
const session = () => ({
  user: { id: 'owner', role: 'OWNER' },
  session: { id: 'session', expiresAt: new Date(Date.now() + 60000) },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(session());
  mocks.authorize.mockImplementation(async () => ({
    ok: true,
    session: session(),
  }));
  mocks.catalog.mockReturnValue([]);
  mocks.apply.mockReturnValue({});
  mocks.sync.mockResolvedValue(undefined);
});
function operation() {
  return {
    id: crypto.randomUUID(),
    recordId: crypto.randomUUID(),
    partition: createHmac('sha256', 'synthetic-unit-secret')
      .update(JSON.stringify(['offline-owner/v1', 'owner']))
      .digest('base64url'),
    yazioEpoch: null,
    base: null,
    payload: {
      kind: 'measurement',
      data: {
        measuredAt: '2026-10-15',
        note: null,
        values: [{ metric: 'weight', value: '75', unit: 'kg' }],
      },
    },
  };
}
function request(body: unknown, origin = 'https://app.example.test') {
  return new Request('https://app.example.test/api/offline/writes', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('derives owner scope from the session and exposes no owner selector', async () => {
  const headers = new Headers();
  const result = await readOfflineWrites(headers);
  expect(result.partition).toBe(operation().partition);
  expect(mocks.catalog).toHaveBeenCalledWith('owner');
  expect(mocks.authorize.mock.calls.map((call) => call.slice(1))).toEqual([
    ['workouts:log', 'owner'],
    ['measurements:write', 'owner'],
  ]);
  expect(result).not.toHaveProperty('ownerId');
});
it.each(['anonymous', 'trainer', 'expired'])(
  'refuses %s before reading or writing',
  async (kind) => {
    mocks.session.mockResolvedValue(
      kind === 'anonymous'
        ? null
        : kind === 'trainer'
          ? { ...session(), user: { id: 'trainer', role: 'TRAINER' } }
          : {
              ...session(),
              session: { id: 'session', expiresAt: new Date(0) },
            },
    );
    const result = await offlineWriteResponse(() =>
      saveOfflineWrite(request(operation())),
    );
    expect([401, 403]).toContain(result.status);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  },
);
it('refuses a role/session change during permission checks', async () => {
  mocks.authorize.mockResolvedValue({
    ok: true,
    session: { ...session(), user: { id: 'owner', role: 'TRAINER' } },
  });
  expect(
    (await offlineWriteResponse(() => saveOfflineWrite(request(operation()))))
      .status,
  ).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();
});
it('rejects foreign partitions and untrusted origins without provider work', async () => {
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(
          request({ ...operation(), partition: 'b'.repeat(43) }),
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await offlineWriteResponse(() =>
        saveOfflineWrite(request(operation(), 'https://other.example.test')),
      )
    ).status,
  ).toBe(403);
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});
it('rejects attempts to select another owner or enqueue settings/documents', async () => {
  for (const body of [
    { ...operation(), ownerId: 'other' },
    { ...operation(), payload: { kind: 'settings', data: {} } },
    { ...operation(), payload: { kind: 'document', data: {} } },
  ]) {
    expect(
      (await offlineWriteResponse(() => saveOfflineWrite(request(body))))
        .status,
    ).toBe(400);
  }
  expect(mocks.apply).not.toHaveBeenCalled();
});
it('returns private no-store responses and delegates accepted measurements to the existing reconciler', async () => {
  const op = operation(),
    result = await offlineWriteResponse(() => saveOfflineWrite(request(op)));
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.apply).toHaveBeenCalledWith('owner', op);
  expect(mocks.sync).toHaveBeenCalledWith('owner');
});
