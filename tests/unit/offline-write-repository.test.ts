import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import Database from 'better-sqlite3';
import * as schema from '@/server/db/schema';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { offlineWriteRepository } from '@/server/offline/write-repository';
import { offlineWriteSchema } from '@/contracts/offline-write';
const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
// Repository unit fixture: only the tables used by this repository, no auth/server/provider runtime.
function fixture() {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  const wanted = new Set([
    'user',
    'measurements',
    'workout_sessions',
    'nutrition_schedule',
    'offline_write_receipts',
  ]);
  for (const file of readdirSync('./drizzle')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(`./drizzle/${file}`, 'utf8');
    for (const match of sql.matchAll(/CREATE TABLE `([^`]+)` \([\s\S]*?\);/g))
      if (wanted.has(match[1]!)) sqlite.exec(match[0]);
  }
  sqlite
    .prepare(
      'INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run('owner', 'Synthetic owner', 'owner@example.test', 0, 0, 0);
  const db = drizzle(sqlite, { schema });
  const repository = offlineWriteRepository({ sqlite, db });
  return { sqlite, repository };
}
function operation() {
  return offlineWriteSchema.parse({
    id: crypto.randomUUID(),
    recordId: crypto.randomUUID(),
    partition: 'a'.repeat(43),
    yazioEpoch: null,
    base: null,
    payload: {
      kind: 'measurement',
      data: {
        measuredAt: '2026-10-15',
        note: null,
        values: [{ metric: 'weight', value: '75', unit: 'kg' }],
      },
    },
  });
}
it('replays a receipt after lost response without creating a second result', () => {
  const { sqlite, repository } = fixture(),
    op = operation();
  const first = repository.apply('owner', op);
  expect(repository.apply('owner', op)).toEqual(first);
  expect(
    sqlite.prepare('SELECT count(*) AS count FROM measurements').get(),
  ).toEqual({ count: 1 });
  expect(
    sqlite
      .prepare('SELECT count(*) AS count FROM offline_write_receipts')
      .get(),
  ).toEqual({ count: 1 });
});
it('refuses operation ID reuse with another payload and never leaks another owner receipt', () => {
  const { repository } = fixture(),
    op = operation();
  repository.apply('owner', op);
  expect(() =>
    repository.apply('owner', {
      ...op,
      payload: {
        kind: 'measurement',
        data: { measuredAt: '2026-10-15', note: 'different', values: [] },
      },
    }),
  ).toThrow();
  expect(repository.catalog('other')).toEqual([]);
});
it('detects a stale measurement baseline while preserving the server record', () => {
  const { repository } = fixture(),
    op = operation();
  const first = repository.apply('owner', op);
  const edit = {
    ...op,
    id: crypto.randomUUID(),
    base: first.version,
    payload: { ...op.payload, data: { ...op.payload.data, note: 'device B' } },
  } as typeof op;
  repository.apply('owner', edit);
  expect(() =>
    repository.apply('owner', {
      ...edit,
      id: crypto.randomUUID(),
      payload: op.payload,
    }),
  ).toThrow();
  expect(repository.catalog('owner')[0]!.payload.data.note).toBe('device B');
});
it('commits the receipt with the record and rolls back both if receipt persistence fails', () => {
  const { sqlite, repository } = fixture();
  sqlite.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON offline_write_receipts BEGIN SELECT RAISE(ABORT, 'full'); END",
  );
  expect(() => repository.apply('owner', operation())).toThrow('full');
  expect(repository.catalog('owner')).toEqual([]);
});
it('uses workout revisions, retains exercise identities, and rejects concurrent device edits', () => {
  const { repository } = fixture();
  const op = offlineWriteSchema.parse({
    ...operation(),
    payload: {
      kind: 'workout',
      data: {
        date: '2026-10-15',
        title: 'Results',
        note: '',
        status: 'completed',
        exercises: [
          {
            id: crypto.randomUUID(),
            name: 'Squat',
            sets: [{ weightKg: 40, reps: 8 }],
          },
        ],
      },
    },
  });
  const first = repository.apply('owner', op);
  expect(first.version).toBe('1');
  const update = { ...op, id: crypto.randomUUID(), base: '1' };
  expect(repository.apply('owner', update).version).toBe('2');
  expect(() =>
    repository.apply('owner', { ...update, id: crypto.randomUUID() }),
  ).toThrow();
  expect(repository.apply('owner', op)).toEqual(first);
  expect(repository.catalog('owner')).toHaveLength(1);
});

it('does not forward a queued measurement into a changed YAZIO connection, but still replays an accepted receipt', () => {
  const { sqlite, repository } = fixture(),
    accepted = operation();
  const first = repository.apply('owner', accepted);
  sqlite
    .prepare('INSERT INTO nutrition_schedule (owner_id,epoch) VALUES (?,?)')
    .run('owner', 2);
  expect(() => repository.apply('owner', operation())).toThrow();
  expect(repository.apply('owner', accepted)).toEqual(first);
  expect(repository.catalog('owner')).toHaveLength(1);
});
