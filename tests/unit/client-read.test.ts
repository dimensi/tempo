import { stepsGoalSchema } from '@/contracts/steps-goal';
import { clearReadStorage } from '@/lib/browser-storage';
import {
  bindReadScope,
  clientReads,
  refreshClientRead,
  seedClientRead,
  updateClientRead,
} from '@/lib/client-read';
import {
  bindSession,
  readSession,
  resetSession,
  sessionGeneration,
} from '@/lib/session-state';
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

it.each([403, 404])(
  'evicts only the denied or deleted GET resource (%s) from memory and disk',
  async (status) => {
    const otherKey = '/api/measurements';
    await seedClientRead(key, { dailyStepsGoal: 123 });
    await seedClientRead(otherKey, []);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' },
          { status },
        ),
      ),
    );
    await expect(refreshClientRead(key)).rejects.toMatchObject({ status });
    expect(clientReads.snapshot(key).data).toBeUndefined();
    expect(readSession()?.partition).toBe('owner');
    expect(clientReads.snapshot(otherKey).data).toBe('[]');
    clientReads.clear();
    await clientReads.restore(key);
    await clientReads.restore(otherKey);
    expect(clientReads.snapshot(key).data).toBeUndefined();
    expect(clientReads.snapshot(otherKey).data).toBe('[]');
  },
);

it('local cache updates use the newest shared value and persist it', async () => {
  await seedClientRead(key, { dailyStepsGoal: 123 });
  await seedClientRead(key, { dailyStepsGoal: 456 });
  const resource = {
    href: key,
    decode: (body: string) => stepsGoalSchema.parse(JSON.parse(body)),
  };
  await updateClientRead(resource, (current) => ({
    dailyStepsGoal: (current?.dailyStepsGoal ?? 0) + 1,
  }));
  expect(clientReads.snapshot(key)).toMatchObject({
    data: '{"dailyStepsGoal":457}',
    coverage: 'complete',
  });
  clientReads.clear();
  await clientReads.restore(key);
  expect(clientReads.snapshot(key).data).toBe('{"dailyStepsGoal":457}');
});
it('local updates without a complete GET snapshot remain partial after restore', async () => {
  const resource = {
    href: key,
    decode: (body: string) => stepsGoalSchema.parse(JSON.parse(body)),
  };
  await updateClientRead(resource, () => ({ dailyStepsGoal: 123 }));
  await updateClientRead(resource, () => ({ dailyStepsGoal: 456 }));
  expect(clientReads.snapshot(key).coverage).toBe('partial');
  clientReads.clear();
  await clientReads.restore(key);
  expect(clientReads.snapshot(key)).toMatchObject({
    data: '{"dailyStepsGoal":456}',
    coverage: 'partial',
  });
});
it('a local update waiting for restore cannot seed a replacement account', async () => {
  const update = vi.fn(() => ({ dailyStepsGoal: 123 }));
  const resource = {
    href: key,
    decode: (body: string) => stepsGoalSchema.parse(JSON.parse(body)),
  };
  const pending = updateClientRead(resource, update, sessionGeneration());
  bindSession(session('other'));
  bindReadScope();
  await seedClientRead(key, { dailyStepsGoal: 999 });
  await pending;
  expect(update).not.toHaveBeenCalled();
  expect(clientReads.snapshot(key).data).toBe('{"dailyStepsGoal":999}');
});
