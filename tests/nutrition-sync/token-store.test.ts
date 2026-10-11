import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { fileTokenStore } = await import('@/server/yazio/token-store');
const secret = 'synthetic-existing-auth-secret-at-least-32-chars';
const token = {
  token_type: 'Bearer',
  access_token: 'synthetic-access-secret',
  refresh_token: 'synthetic-refresh-secret',
  expires_in: 3600,
  expires_at: 9999999999999,
};
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'yazio-encrypted-test-'));
  path = join(directory, 'connection.json');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it('encrypts full tokens, writes private atomic files, and rotates nonce/generation on refresh', async () => {
  const store = fileTokenStore(path, 'synthetic-owner', secret);
  await store.save(token);
  const first = await readFile(path, 'utf8');
  expect(first).not.toContain(token.access_token);
  expect(first).not.toContain(token.refresh_token);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await store.load()).toEqual(token);
  await store.save({ ...token, access_token: 'rotated-synthetic-access' });
  const second = JSON.parse(await readFile(path, 'utf8'));
  const original = JSON.parse(first);
  expect(second.version).toBe(1);
  expect(second.iv).not.toBe(original.iv);
  expect(second.generation).not.toBe(original.generation);
  expect(await fileTokenStore(path, 'synthetic-owner', secret).load()).toEqual({
    ...token,
    access_token: 'rotated-synthetic-access',
  });
});
it('rejects wrong key/owner, tampered generation/tag/ciphertext and legacy plaintext without fallback', async () => {
  const store = fileTokenStore(path, 'synthetic-owner', secret);
  await store.save(token);
  await expect(
    fileTokenStore(path, 'other-owner', secret).load(),
  ).rejects.toThrow('Unable to read encrypted');
  await expect(
    fileTokenStore(path, 'synthetic-owner', secret + 'different').load(),
  ).rejects.toThrow('Unable to read encrypted');
  const original = JSON.parse(await readFile(path, 'utf8'));
  for (const field of ['generation', 'tag', 'ciphertext'] as const) {
    await writeFile(
      path,
      JSON.stringify({
        ...original,
        [field]:
          field === 'generation'
            ? '00000000-0000-4000-8000-000000000000'
            : Buffer.from('tampered').toString('base64'),
      }),
    );
    await expect(store.load()).rejects.toThrow('Unable to read encrypted');
  }
  await writeFile(path, JSON.stringify(token));
  await expect(store.load()).rejects.toThrow('Unable to read encrypted');
});
it('disconnect tombstone prevents stale refresh and delayed connect from resurrecting tokens', async () => {
  const connected = fileTokenStore(path, 'synthetic-owner', secret);
  await connected.save(token);
  const stale = fileTokenStore(path, 'synthetic-owner', secret);
  await stale.load();
  const pendingConnect = fileTokenStore(path, 'synthetic-owner', secret);
  await pendingConnect.load();
  await connected.disconnect();
  expect(
    await fileTokenStore(path, 'synthetic-owner', secret).load(),
  ).toBeNull();
  await expect(stale.assertCurrent!()).rejects.toThrow('connection changed');
  await expect(stale.save(token)).rejects.toThrow('connection changed');
  await expect(pendingConnect.save(token)).rejects.toThrow(
    'connection changed',
  );
  expect(
    await fileTokenStore(path, 'synthetic-owner', secret).load(),
  ).toBeNull();
  const explicitReconnect = fileTokenStore(path, 'synthetic-owner', secret);
  await explicitReconnect.load();
  await explicitReconnect.save(token);
  expect(await explicitReconnect.load()).toEqual(token);
});
it('serializes concurrent refreshes using loaded generation rather than losing disconnect/new connection', async () => {
  const original = fileTokenStore(path, 'synthetic-owner', secret);
  await original.save(token);
  const a = fileTokenStore(path, 'synthetic-owner', secret);
  const b = fileTokenStore(path, 'synthetic-owner', secret);
  await a.load();
  await b.load();
  const results = await Promise.allSettled([
    a.save({ ...token, access_token: 'a' }),
    b.save({ ...token, access_token: 'b' }),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(
    (await fileTokenStore(path, 'synthetic-owner', secret).load())!
      .access_token,
  ).toBe('a');
});
