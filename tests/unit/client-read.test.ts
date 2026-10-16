import { clearReadStorage } from '@/lib/browser-storage';
import {
  bindReadScope,
  clientReads,
  refreshClientRead,
  seedClientRead,
} from '@/lib/client-read';
import { bindSession, resetSession } from '@/lib/session-state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { indexedDBDriver } from './helpers/browser-db';
const session = (partition = 'owner') => ({
  readerId: partition,
  ownerId: partition,
  role: 'OWNER' as const,
  partition,
});
beforeEach(() => {
  const driver = indexedDBDriver();
  vi.stubGlobal('indexedDB', driver.factory);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', {});
  vi.stubGlobal('location', { origin: 'https://app.test' });
  vi.stubGlobal('navigator', { onLine: true });
  bindSession(session());
  bindReadScope();
  clientReads.clear();
});
afterEach(() => vi.unstubAllGlobals());
const key = '/api/settings/steps-goal';
it('publishes stored data while the network request remains pending', async () => {
  await seedClientRead(key, { dailyStepsGoal: 123 });
  clientReads.clear();
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const flight = refreshClientRead(key);
  await vi.waitFor(() =>
    expect(clientReads.snapshot(key).data).toContain('123'),
  );
  expect(clientReads.snapshot(key).refreshing).toBe(true);
  resolve(Response.json({ dailyStepsGoal: 456 }));
  await flight;
  expect(clientReads.snapshot(key).data).toContain('456');
});
it('does not reuse another account cache', async () => {
  await seedClientRead(key, { dailyStepsGoal: 123 });
  bindSession(session('other'));
  bindReadScope();
  await clientReads.restore(key);
  expect(clientReads.snapshot(key).data).toBeUndefined();
});
it('late network replies cannot refill a logged-out store', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const flight = refreshClientRead(key);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  resetSession();
  clientReads.clear();
  const rejected = expect(flight).rejects.toMatchObject({ reason: 'denied' });
  resolve(Response.json({ dailyStepsGoal: 456 }));
  await rejected;
  expect(clientReads.snapshot(key).data).toBeUndefined();
});
it('corrupted disk records are cache misses', async () => {
  const driver = indexedDBDriver();
  vi.stubGlobal('indexedDB', driver.factory);
  await seedClientRead(key, { dailyStepsGoal: 123 });
  const records = driver.data.get('resources')!;
  for (const [id, value] of records)
    records.set(id, {
      ...(value as { record: object }),
      record: { ...(value as { record: object }).record, body: '{broken' },
    });
  clientReads.clear();
  await clientReads.restore(key);
  expect(clientReads.snapshot(key).data).toBeUndefined();
});
it('read cache clearing is independent of owner write queue', async () => {
  await seedClientRead(key, { dailyStepsGoal: 123 });
  await clearReadStorage();
  clientReads.clear();
  await clientReads.restore(key);
  expect(clientReads.snapshot(key).data).toBeUndefined();
});
