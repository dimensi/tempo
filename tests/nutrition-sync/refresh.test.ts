import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { fileTokenStore } = await import('@/server/yazio/token-store');
const { createYazioClient } = await import('@/server/yazio/client');
let directory: string;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function expiredStore() {
  directory = await mkdtemp(join(tmpdir(), 'yazio-refresh-test-'));
  const path = join(directory, 'connection.json');
  const secret = 'synthetic-existing-auth-secret-for-refresh-12345';
  const store = fileTokenStore(path, 'owner', secret);
  await store.save({
    token_type: 'Bearer',
    access_token: 'synthetic-expired',
    refresh_token: 'synthetic-refresh',
    expires_in: 1,
    expires_at: 0,
  });
  return { path, secret, store };
}
const refreshed = () =>
  Response.json({
    token_type: 'Bearer',
    access_token: 'synthetic-new-access',
    refresh_token: 'synthetic-new-refresh',
    expires_in: 3600,
  });
it('uses actual SDK refresh and waits for encrypted persistence before downstream request', async () => {
  const { store } = await expiredStore();
  let release!: () => void;
  const save = store.save.bind(store);
  store.save = async (token) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await save(token);
  };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(refreshed())
    .mockImplementation(async () => Response.json({}));
  const client = await createYazioClient(store);
  const pending = Promise.all([
    client.user.getMealImages({ date: '2026-01-01' }),
    client.user.getMealImages({ date: '2026-01-02' }),
  ]);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(fetch).toHaveBeenCalledTimes(1);
  release();
  expect(await pending).toEqual([{}, {}]);
  expect(fetch).toHaveBeenCalledTimes(3);
  const persisted = await store.load();
  expect(persisted!.access_token).toBe('synthetic-new-access');
  expect(persisted!.refresh_token).toBe('synthetic-new-refresh');
});
it('handles rejected SDK refresh persistence and cannot resurrect a disconnected connection', async () => {
  const { path, secret, store } = await expiredStore();
  let release!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const client = await createYazioClient(store);
  const pending = client.user.getMealImages({ date: '2026-01-01' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const disconnected = fileTokenStore(path, 'owner', secret);
  await disconnected.load();
  await disconnected.disconnect();
  release(refreshed());
  await expect(pending).rejects.toThrow('YAZIO request failed');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await disconnected.load()).toBeNull();
});
