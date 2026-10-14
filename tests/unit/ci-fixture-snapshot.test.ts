import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyFixtureSnapshot } from '../ci/fixture-snapshot';
test('only an exact closed fixture in an isolated family can skip synthetic preparation', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ci-fixture-guard-'));
  const path = resolve(directory, '.data/e2e.sqlite');
  const fixture = Buffer.from('synthetic snapshot guard fixture');
  const hash = createHash('sha256').update(fixture).digest('hex');
  try {
    mkdirSync(resolve(directory, '.data'));
    writeFileSync(path, fixture);
    for (const family of ['general', 'smoke', 'isolation'])
      expect(() =>
        verifyFixtureSnapshot(family, hash, directory),
      ).not.toThrow();
    for (const family of ['nutrition', 'transformmate', 'offline', 'unknown'])
      expect(() => verifyFixtureSnapshot(family, hash, directory)).toThrow(
        'isolated browser families',
      );
    expect(() =>
      verifyFixtureSnapshot('general', 'invalid', directory),
    ).toThrow('isolated browser families');
    expect(() =>
      verifyFixtureSnapshot('general', '0'.repeat(64), directory),
    ).toThrow('fresh exact copy');
    writeFileSync(path, 'mutated snapshot');
    expect(() => verifyFixtureSnapshot('general', hash, directory)).toThrow(
      'fresh exact copy',
    );
    writeFileSync(path, fixture);
    for (const suffix of ['-wal', '-shm']) {
      writeFileSync(path + suffix, '');
      expect(() => verifyFixtureSnapshot('general', hash, directory)).toThrow(
        'fresh exact copy',
      );
      rmSync(path + suffix);
    }
    rmSync(path);
    expect(() => verifyFixtureSnapshot('general', hash, directory)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
