import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
vi.mock('server-only', () => ({}));
const config = vi.hoisted(() => ({ path: '' }));
vi.mock('@/server/env', () => ({
  readServerEnv: () => ({
    TRANSFORMMATE_TOKEN_FILE: config.path,
    BETTER_AUTH_SECRET: 'synthetic-auth-secret-at-least-32-characters',
    UPLOADS_DIR: '.unused-uploads',
  }),
}));
import {
  configuredTransformMateStore,
  getTransformMateClient,
  getTransformMateConnectionFence,
  invalidateTransformMateClient,
} from '@/server/transformmate/runtime';
let directory: string;
const value = () => ({
  connectionId: randomUUID(),
  apiKey: 'synthetic-api',
  refreshToken: 'synthetic-refresh',
  userId: 'firebase-owner',
  projectId: 'firebase-project',
  account: { id: 7, name: 'Synthetic', email: null },
  checkedAt: new Date().toISOString(),
});
const refreshed = (extra = {}) =>
  new Response(
    JSON.stringify({
      id_token: 'synthetic-id',
      refresh_token: 'synthetic-rotation',
      expires_in: '3600',
      user_id: 'firebase-owner',
      project_id: 'firebase-project',
      ...extra,
    }),
    { status: 200 },
  );
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tm-runtime-'));
  config.path = join(directory, 'private', 'token.json');
});
afterEach(async () => {
  invalidateTransformMateClient('owner');
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
async function connected() {
  const store = configuredTransformMateStore('owner');
  await store.load();
  await store.save(value());
  return store;
}
it('persists rotation before API request and preserves stable connection fence', async () => {
  await connected();
  const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes('securetoken.googleapis.com'))
      return refreshed();
    expect(
      (await configuredTransformMateStore('owner').load()).token?.refreshToken,
    ).toBe('synthetic-rotation');
    return new Response(
      JSON.stringify({
        id: 7,
        first_name: 'Synthetic',
        last_name: 'User',
        email: null,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', request);
  const fence = await getTransformMateConnectionFence('owner');
  const client = await getTransformMateClient('owner');
  await client!.getMe();
  await fence!.assertCurrent();
  expect((await getTransformMateConnectionFence('owner'))?.generation).toBe(
    fence?.generation,
  );
});
it('disconnect during delayed refresh rejects late rotation without resurrecting', async () => {
  await connected();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request = vi.fn<typeof fetch>().mockImplementation(async () => {
    started();
    return pending;
  });
  vi.stubGlobal('fetch', request);
  const client = await getTransformMateClient('owner');
  const operation = client!.getMe();
  await began;
  const store = configuredTransformMateStore('owner');
  await store.load();
  await store.disconnect();
  invalidateTransformMateClient('owner');
  finish(refreshed());
  await expect(operation).rejects.toThrow();
  expect((await configuredTransformMateStore('owner').load()).token).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([{ user_id: 'other-owner' }, { project_id: 'other-project' }])(
  'rejects changed Firebase identity before persistence or API request %j',
  async (extra) => {
    await connected();
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => refreshed(extra));
    vi.stubGlobal('fetch', request);
    const client = await getTransformMateClient('owner');
    await expect(client!.getMe()).rejects.toThrow();
    expect(
      (await configuredTransformMateStore('owner').load()).token?.refreshToken,
    ).toBe('synthetic-refresh');
    expect(request).toHaveBeenCalledTimes(1);
  },
);
it('nonrotating identity mismatch cannot reach API on repeated cached-token calls', async () => {
  await connected();
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      refreshed({ user_id: 'other-owner', refresh_token: 'synthetic-refresh' }),
    );
  vi.stubGlobal('fetch', request);
  const client = await getTransformMateClient('owner');
  await expect(client!.getMe()).rejects.toThrow();
  await expect(client!.getMe()).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
it('disconnect while API response is pending rejects returned data', async () => {
  await connected();
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
      if (String(input).includes('securetoken.googleapis.com'))
        return refreshed();
      started();
      return pending;
    }),
  );
  const client = await getTransformMateClient('owner');
  const operation = client!.getMe();
  await began;
  const store = configuredTransformMateStore('owner');
  await store.load();
  await store.disconnect();
  finish(new Response('{}', { status: 200 }));
  await expect(operation).rejects.toThrow();
  expect((await store.load()).token).toBeNull();
});

it('deduplicates concurrent cold clients and their first refresh rotation', async () => {
  await connected();
  const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes('securetoken.googleapis.com'))
      return refreshed();
    return new Response(JSON.stringify({ id: 7 }), { status: 200 });
  });
  vi.stubGlobal('fetch', request);
  const [first, second] = await Promise.all([
    getTransformMateClient('owner'),
    getTransformMateClient('owner'),
  ]);
  expect(first).toBe(second);
  await Promise.all([first!.getMe(), second!.getMe()]);
  expect(
    request.mock.calls.filter((call) =>
      String(call[0]).includes('securetoken.googleapis.com'),
    ),
  ).toHaveLength(1);
  expect(
    request.mock.calls.filter(
      (call) => !String(call[0]).includes('securetoken.googleapis.com'),
    ),
  ).toHaveLength(2);
  expect(
    (await configuredTransformMateStore('owner').load()).token?.refreshToken,
  ).toBe('synthetic-rotation');
});
