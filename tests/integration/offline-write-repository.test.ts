import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import * as schema from '@/server/db/schema';
import { offlineWriteRepository } from '@/server/offline/write-repository';
import { offlineWriteSchema } from '@/contracts/offline-write';

vi.mock('server-only', () => ({}));
const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

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
  return {
    sqlite,
    repository: offlineWriteRepository({
      sqlite,
      db: drizzle(sqlite, { schema }),
    }),
  };
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

it('commits an offline receipt with its record and replays it without cross-owner data', () => {
  const { sqlite, repository } = fixture();
  const op = operation();
  const first = repository.apply('owner', op);
  expect(repository.apply('owner', op)).toEqual(first);
  expect(
    sqlite.prepare('SELECT count(*) AS count FROM measurements').get(),
  ).toEqual({ count: 1 });
  expect(repository.catalog('other')).toEqual([]);

  const failed = fixture();
  failed.sqlite.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON offline_write_receipts BEGIN SELECT RAISE(ABORT, 'full'); END",
  );
  expect(() => failed.repository.apply('owner', operation())).toThrow('full');
  expect(failed.repository.catalog('owner')).toEqual([]);
});
