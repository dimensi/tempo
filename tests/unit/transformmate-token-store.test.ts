import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rm,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  fileTransformMateTokenStore,
  TransformMateStaleConnectionError,
  TransformMateStorageError,
} from '@/server/transformmate/token-store';
vi.mock('server-only', () => ({}));
const secret = 'synthetic-auth-secret-with-at-least-32-characters';
const token = () => ({
  connectionId: randomUUID(),
  apiKey: 'synthetic-key',
  refreshToken: 'synthetic-refresh',
  userId: 'firebase-user',
  projectId: 'firebase-project',
  account: { id: 123, name: 'Example User', email: 'example@example.test' },
  checkedAt: new Date().toISOString(),
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'tm-store-'));
  directories.push(dir);
  const path = join(dir, 'private', 'token.json');
  return { path, store: fileTransformMateTokenStore(path, 'owner', secret) };
}
describe('TransformMate encrypted connection', () => {
  it('encrypts secrets/profile with owner and key authentication and private permissions', async () => {
    const { path, store } = await setup();
    await store.load();
    const value = token();
    await store.save(value);
    const bytes = await readFile(path, 'utf8');
    expect(bytes).not.toContain(value.refreshToken);
    expect(bytes).not.toContain(value.apiKey);
    expect(bytes).not.toContain(value.account.email);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    expect((await store.load()).token).toEqual(value);
    await expect(
      fileTransformMateTokenStore(path, 'other-owner', secret).load(),
    ).rejects.toBeInstanceOf(TransformMateStorageError);
    await expect(
      fileTransformMateTokenStore(
        path,
        'owner',
        'other-secret-with-at-least-32-characters',
      ).load(),
    ).rejects.toBeInstanceOf(TransformMateStorageError);
    const envelope = JSON.parse(bytes);
    envelope.generation = randomUUID();
    await writeFile(path, JSON.stringify(envelope));
    await expect(store.load()).rejects.toBeInstanceOf(
      TransformMateStorageError,
    );
  });
  it('retains binding in an encrypted tombstone and blocks late save/refresh/assert', async () => {
    const { path, store } = await setup();
    await store.load();
    const value = token();
    await store.save(value);
    const late = fileTransformMateTokenStore(path, 'owner', secret);
    await late.load();
    await store.disconnect();
    const state = await store.load();
    expect(state.token).toBeNull();
    expect(state.binding).toEqual({
      account: value.account,
      userId: value.userId,
      projectId: value.projectId,
    });
    await expect(
      late.save({ ...value, refreshToken: 'late-refresh' }),
    ).rejects.toBeInstanceOf(TransformMateStaleConnectionError);
    await expect(late.assertCurrent()).rejects.toBeInstanceOf(
      TransformMateStaleConnectionError,
    );
    expect((await store.load()).token).toBeNull();
  });
  it('serializes competing connects and rotations with generation CAS', async () => {
    const { path, store } = await setup();
    await store.load();
    const other = fileTransformMateTokenStore(path, 'owner', secret);
    await other.load();
    const results = await Promise.allSettled([
      store.save(token()),
      other.save(token()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const value = (await store.load()).token!;
    await other.load();
    await store.save({ ...value, refreshToken: 'rotated' });
    await expect(other.disconnect()).rejects.toBeInstanceOf(
      TransformMateStaleConnectionError,
    );
    expect((await store.load()).token?.refreshToken).toBe('rotated');
  });
  it('rejects oversized storage/input and preserves a valid file on validation failure', async () => {
    const { path, store } = await setup();
    await store.load();
    const value = token();
    await store.save(value);
    const before = await readFile(path, 'utf8');
    await expect(
      store.save({ ...value, refreshToken: 'x'.repeat(8193) }),
    ).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    await chmod(dirname(path), 0o755);
    await store.save(value);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    await writeFile(path, 'x'.repeat(65537));
    await expect(store.load()).rejects.toBeInstanceOf(
      TransformMateStorageError,
    );
  });
});
