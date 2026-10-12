import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
// Unit-only collaborators; real-session security coverage belongs to E2E.
const state = vi.hoisted(() => ({
  path: '',
  status: 200,
  links: [] as { remoteTrainingId: number | null; state: string }[],
}));
vi.mock('@/server/auth/guards', () => ({
  authorize: async () =>
    state.status === 200
      ? { ok: true, session: { user: { id: 'owner', role: 'OWNER' } } }
      : { ok: false, status: state.status },
}));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    TRANSFORMMATE_TOKEN_FILE: state.path,
    BETTER_AUTH_SECRET: 'synthetic-auth-secret-at-least-32-characters',
    UPLOADS_DIR: '.unused-uploads',
    BETTER_AUTH_URL: 'https://dashboard.example.test',
  }),
}));
vi.mock('@/server/db', () => ({
  getDatabase: () => ({
    db: {
      select: () => ({
        from: () => ({ where: () => ({ all: () => state.links }) }),
      }),
    },
  }),
}));
import {
  connectTransformMate,
  disconnectTransformMate,
  getTransformMateStatus,
  checkTransformMate,
} from '@/server/transformmate/connection';
import {
  configuredTransformMateStore,
  invalidateTransformMateClient,
} from '@/server/transformmate/runtime';
import * as tokenStores from '@/server/transformmate/token-store';
import { POST } from '@/app/api/transformmate/connect/route';
import { readTransformMateJson } from '@/server/transformmate/http';
let directory: string;
const headers = new Headers();
const credentials = {
  apiKey: 'synthetic-api',
  refreshToken: 'synthetic-refresh',
};
const me = (id = 7) => ({
  id,
  first_name: 'Synthetic',
  last_name: 'User',
  email: 'example@example.test',
});
const auth = () =>
  new Response(
    JSON.stringify({
      id_token: 'synthetic-id',
      refresh_token: 'synthetic-refresh',
      expires_in: '3600',
      user_id: 'firebase-owner',
      project_id: 'firebase-project',
    }),
    { status: 200 },
  );
function upstream(id = 7) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).includes('securetoken.googleapis.com')
        ? auth()
        : new Response(JSON.stringify(me(id)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tm-connection-'));
  state.path = join(directory, 'private', 'token.json');
  state.status = 200;
  state.links = [];
  upstream();
});
afterEach(async () => {
  invalidateTransformMateClient('owner');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
it('validates profile, persists only encrypted connection, checks and disconnects with retained binding', async () => {
  const connected = await connectTransformMate(headers, credentials);
  expect(connected).toMatchObject({
    configured: true,
    account: { id: 7, name: 'Synthetic User', email: 'example@example.test' },
    errorCode: null,
  });
  expect(await checkTransformMate(headers, {})).toMatchObject({
    configured: true,
    errorCode: null,
  });
  const result = await disconnectTransformMate(headers, {});
  expect(result).toEqual({
    configured: false,
    account: null,
    checkedAt: null,
    errorCode: null,
  });
  const saved = await configuredTransformMateStore('owner').load();
  expect(saved.binding?.account.id).toBe(7);
  expect(saved.token).toBeNull();
});
it('allows pending never-attempted links on first connect and rejects unbound attempted history', async () => {
  state.links = [
    { remoteTrainingId: null, state: JSON.stringify({ attempted: false }) },
  ];
  await expect(
    connectTransformMate(headers, credentials),
  ).resolves.toMatchObject({ configured: true });
  await disconnectTransformMate(headers, {});
  await rm(state.path);
  state.links = [
    { remoteTrainingId: null, state: JSON.stringify({ attempted: true }) },
  ];
  await expect(connectTransformMate(headers, credentials)).rejects.toThrow(
    'binding',
  );
  expect((await configuredTransformMateStore('owner').load()).token).toBeNull();
});
it('retained binding prevents another account from inheriting links and permits same account reconnect', async () => {
  await connectTransformMate(headers, credentials);
  state.links = [
    { remoteTrainingId: 5, state: JSON.stringify({ attempted: true }) },
  ];
  await disconnectTransformMate(headers, {});
  upstream(8);
  await expect(connectTransformMate(headers, credentials)).rejects.toThrow(
    'binding',
  );
  expect((await configuredTransformMateStore('owner').load()).token).toBeNull();
  upstream(7);
  await expect(
    connectTransformMate(headers, credentials),
  ).resolves.toMatchObject({ configured: true, account: { id: 7 } });
});
it('failed validation/upstream preserves existing file and failed check reports a safe status', async () => {
  await connectTransformMate(headers, credentials);
  const before = await readFile(state.path, 'utf8');
  await expect(
    connectTransformMate(headers, {
      ...credentials,
      refreshToken: 'x'.repeat(8193),
    }),
  ).rejects.toThrow();
  expect(await readFile(state.path, 'utf8')).toBe(before);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValue(
        new Error('synthetic-api synthetic-refresh raw failure'),
      ),
  );
  await expect(connectTransformMate(headers, credentials)).rejects.toThrow();
  expect(await readFile(state.path, 'utf8')).toBe(before);
  expect(await checkTransformMate(headers, {})).toMatchObject({
    configured: true,
    errorCode: 'upstream_error',
  });
  expect(await readFile(state.path, 'utf8')).toBe(before);
});
it('delayed connect cannot overwrite a disconnect tombstone', async () => {
  await connectTransformMate(headers, credentials);
  let finish!: (response: Response) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).includes('securetoken.googleapis.com')) return auth();
      started();
      return pending;
    }),
  );
  const operation = connectTransformMate(headers, credentials);
  await began;
  await disconnectTransformMate(headers, {});
  finish(
    new Response(JSON.stringify(me()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(operation).rejects.toThrow('changed');
  expect(await getTransformMateStatus(headers)).toMatchObject({
    configured: false,
  });
});
it('route returns contract envelope and rejects access/origin without echoing credentials', async () => {
  const request = () =>
    new Request('https://dashboard.example.test/api/transformmate/connect', {
      method: 'POST',
      headers: { origin: 'https://dashboard.example.test' },
      body: JSON.stringify(credentials),
    });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({
    contractVersion: 1,
    source: 'user',
    data: { configured: true },
  });
  for (const denied of [401, 403]) {
    state.status = denied;
    const result = await POST(request());
    expect(result.status).toBe(denied);
    expect(await result.text()).not.toContain(credentials.refreshToken);
  }
  state.status = 200;
  expect(
    (
      await POST(
        new Request(
          'https://dashboard.example.test/api/transformmate/connect',
          {
            method: 'POST',
            headers: { origin: 'https://evil.example.test' },
            body: JSON.stringify(credentials),
          },
        ),
      )
    ).status,
  ).toBe(403);
});
it('bounds request stream bytes before JSON parse and rejects malformed JSON', async () => {
  await expect(
    readTransformMateJson(
      new Request('https://dashboard.example.test', {
        method: 'POST',
        body: 'x'.repeat(12289),
      }),
    ),
  ).rejects.toThrow();
  await expect(
    readTransformMateJson(
      new Request('https://dashboard.example.test', {
        method: 'POST',
        body: '{invalid',
      }),
    ),
  ).rejects.toThrow();
});

function revokeOnLoad(target: number, fail = false) {
  const original = tokenStores.fileTransformMateTokenStore;
  let loads = 0;
  vi.spyOn(tokenStores, 'fileTransformMateTokenStore').mockImplementation(
    (...args) => {
      const store = original(...args);
      const load = store.load;
      store.load = async () => {
        loads++;
        if (loads === target && fail) {
          state.status = 403;
          throw new tokenStores.TransformMateStorageError();
        }
        const result = await load();
        if (loads === target) state.status = 403;
        return result;
      };
      return store;
    },
  );
}
it.each(['connect', 'check', 'disconnect'] as const)(
  'rechecks authorization after %s final status load',
  async (operation) => {
    if (operation !== 'connect')
      await connectTransformMate(headers, credentials);
    invalidateTransformMateClient('owner');
    revokeOnLoad(operation === 'check' ? 4 : 2);
    const result =
      operation === 'connect'
        ? connectTransformMate(headers, credentials)
        : operation === 'check'
          ? checkTransformMate(headers, {})
          : disconnectTransformMate(headers, {});
    await expect(result).rejects.toMatchObject({ status: 403 });
  },
);
it('rechecks authorization after failed storage lookup before returning status error', async () => {
  revokeOnLoad(1, true);
  await expect(getTransformMateStatus(headers)).rejects.toMatchObject({
    status: 403,
  });
});
it('rechecks authorization after failed check final error status load', async () => {
  await connectTransformMate(headers, credentials);
  invalidateTransformMateClient('owner');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('synthetic upstream failure')),
  );
  revokeOnLoad(3);
  await expect(checkTransformMate(headers, {})).rejects.toMatchObject({
    status: 403,
  });
});
