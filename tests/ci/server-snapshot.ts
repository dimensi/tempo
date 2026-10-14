import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';

type Entry = { mode: number } & (
  | { kind: 'directory' }
  | { kind: 'file'; hash: string }
  | { kind: 'symlink'; target: string }
);
function inventory(root: string) {
  const entries = new Map<string, Entry>();
  function visit(directory: string) {
    for (const name of readdirSync(join(root, directory))) {
      const path = join(directory, name);
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink()) {
        entries.set(path, {
          kind: 'symlink',
          mode,
          target: readlinkSync(absolute),
        });
      } else if (stat.isDirectory()) {
        entries.set(path, { kind: 'directory', mode });
        visit(path);
      } else if (stat.isFile()) {
        entries.set(path, {
          kind: 'file',
          mode,
          hash: createHash('sha256')
            .update(readFileSync(absolute))
            .digest('hex'),
        });
      } else throw new Error('Unsupported file in production server snapshot');
    }
  }
  visit('');
  return entries;
}
// Read EVERY file, including same-size/same-mtime mutations. Only identical
// bytes are reused; no hard links or writable shared build assets are involved.
export function serverSnapshot(snapshot: string) {
  const expected = inventory(snapshot);
  const rootMode = lstatSync(snapshot).mode & 0o777;
  return (destination: string) => {
    const root = lstatSync(destination, { throwIfNoEntry: false });
    if (root && (!root.isDirectory() || root.isSymbolicLink()))
      rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    chmodSync(destination, rootMode);
    const current = inventory(destination);
    for (const [path, entry] of [...current].reverse()) {
      if (expected.get(path)?.kind !== entry.kind)
        rmSync(join(destination, path), { recursive: true, force: true });
    }
    for (const [path, entry] of expected) {
      const absolute = join(destination, path);
      const previous = current.get(path);
      if (entry.kind === 'directory') mkdirSync(absolute, { recursive: true });
      else if (entry.kind === 'file') {
        if (previous?.kind !== 'file' || previous.hash !== entry.hash)
          copyFileSync(join(snapshot, path), absolute);
      } else if (
        previous?.kind !== 'symlink' ||
        previous.target !== entry.target
      ) {
        rmSync(absolute, { force: true });
        symlinkSync(entry.target, absolute);
      }
      if (entry.kind !== 'symlink' && previous?.mode !== entry.mode)
        chmodSync(absolute, entry.mode);
    }
  };
}
