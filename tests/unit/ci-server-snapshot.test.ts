import { test, expect } from 'vitest';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readlinkSync,
  utimesSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverSnapshot } from '../ci/server-snapshot';

test('full byte restoration handles deleted, extra, type-changed, same-mtime files and symlinks without touching external targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'yazio-snapshot-test-'));
  try {
    const snapshot = join(root, 'snapshot'),
      live = join(root, 'live');
    mkdirSync(join(snapshot, 'directory'), { recursive: true });
    writeFileSync(join(snapshot, 'same'), 'good');
    writeFileSync(join(snapshot, 'directory/deleted'), 'restore');
    writeFileSync(join(snapshot, 'type'), 'file');
    symlinkSync('same', join(snapshot, 'link'));
    cpSync(snapshot, live, { recursive: true, verbatimSymlinks: true });
    const restore = serverSnapshot(snapshot);
    const original = statSync(join(live, 'same'));
    writeFileSync(join(live, 'same'), 'evil');
    utimesSync(join(live, 'same'), original.atime, original.mtime);
    chmodSync(join(live, 'same'), 0o600);
    rmSync(join(live, 'directory'), { recursive: true });
    symlinkSync(root, join(live, 'directory'));
    rmSync(join(live, 'type'));
    mkdirSync(join(live, 'type'));
    writeFileSync(join(live, 'extra'), 'remove');
    rmSync(join(live, 'link'));
    symlinkSync('extra', join(live, 'link'));
    chmodSync(live, 0o700);
    restore(live);
    expect(statSync(live).mode & 0o777).toBe(statSync(snapshot).mode & 0o777);
    expect(readFileSync(join(live, 'same'), 'utf8')).toBe('good');
    expect(statSync(join(live, 'same')).mode & 0o777).toBe(
      statSync(join(snapshot, 'same')).mode & 0o777,
    );
    expect(readFileSync(join(live, 'directory/deleted'), 'utf8')).toBe(
      'restore',
    );
    expect(readFileSync(join(live, 'type'), 'utf8')).toBe('file');
    expect(readlinkSync(join(live, 'link'))).toBe('same');
    expect(() => statSync(join(live, 'extra'))).toThrow();
    restore(live);
    expect(readFileSync(join(snapshot, 'same'), 'utf8')).toBe('good');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
