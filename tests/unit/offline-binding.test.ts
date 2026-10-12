import { expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
vi.mock('server-only', () => ({}));
import {
  fileTransformMateTokenStore,
  readTransformMateOfflineBinding,
} from '@/server/transformmate/token-store';
test('local binding stays stable across refresh, changes on reconnect, and clears on tombstone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'offline-binding-'));
  const file = join(directory, 'synthetic.json');
  const secret = 'synthetic-offline-secret-at-least-32-characters';
  try {
    expect(
      await readTransformMateOfflineBinding(file, 'owner', secret),
    ).toMatchObject({ configured: false, connectionId: null, revision: 0 });
    const store = fileTransformMateTokenStore(file, 'owner', secret);
    await store.load();
    const token = {
      connectionId: randomUUID(),
      apiKey: 'synthetic-key',
      refreshToken: 'synthetic-refresh',
      userId: 'synthetic-user',
      projectId: 'synthetic-project',
      account: {
        id: 1,
        name: 'Synthetic private profile',
        email: 'synthetic@example.test',
      },
      checkedAt: '2026-10-12T12:00:00Z',
    };
    await store.save(token);
    const first = await readTransformMateOfflineBinding(file, 'owner', secret);
    await store.save({ ...token, refreshToken: 'synthetic-rotated' });
    expect(
      await readTransformMateOfflineBinding(file, 'owner', secret),
    ).toEqual(first);
    expect(Object.keys(first).sort()).toEqual([
      'configured',
      'connectionId',
      'revision',
    ]);
    await store.disconnect();
    expect(
      await readTransformMateOfflineBinding(file, 'owner', secret),
    ).toMatchObject({
      configured: false,
      connectionId: null,
      revision: first.revision + 1,
    });
    await store.save({ ...token, connectionId: randomUUID() });
    expect(
      await readTransformMateOfflineBinding(file, 'owner', secret),
    ).not.toEqual(first);
    await writeFile(file, 'invalid-local-store');
    await expect(
      readTransformMateOfflineBinding(file, 'owner', secret),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
