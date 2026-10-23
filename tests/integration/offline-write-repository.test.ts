import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/server/db/schema';
import { offlineWriteRepository } from '@/server/offline/write-repository';
import { offlineWriteSchema } from '@/contracts/offline-write';

vi.mock('server-only', () => ({}));
const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function fixture() {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
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

  const exercise = {
    id: crypto.randomUUID(),
    name: 'Synthetic squat',
    sets: [{ reps: 8, weightKg: 40 }],
  };
  const workout = offlineWriteSchema.parse({
    ...operation(),
    payload: {
      kind: 'workout',
      data: {
        date: '2026-10-15',
        title: '',
        note: '',
        status: 'planned',
        exercises: [exercise],
      },
    },
  });
  const recorded = repository.apply('owner', workout);
  const next = offlineWriteSchema.parse({
    ...workout,
    id: crypto.randomUUID(),
    base: recorded.version,
    payload: {
      kind: 'workout',
      data: {
        ...workout.payload.data,
        exercises: [
          exercise,
          { ...exercise, id: crypto.randomUUID(), name: 'Synthetic row' },
        ],
      },
    },
  });
  const extended = repository.apply('owner', next);
  expect(
    extended.payload.kind === 'workout' && extended.payload.data.exercises,
  ).toHaveLength(2);
  if (next.payload.kind !== 'workout')
    throw new Error('Expected workout fixture');
  const withoutSets = offlineWriteSchema.parse({
    ...next,
    id: crypto.randomUUID(),
    base: extended.version,
    payload: {
      kind: 'workout',
      data: {
        ...next.payload.data,
        exercises: [
          { ...exercise, sets: [] },
          ...next.payload.data.exercises.slice(1),
        ],
      },
    },
  });
  const retained = repository.apply('owner', withoutSets);
  expect(
    retained.payload.kind === 'workout' && retained.payload.data.exercises[0],
  ).toEqual({ ...exercise, sets: [] });
  const removal = offlineWriteSchema.parse({
    ...next,
    id: crypto.randomUUID(),
    base: retained.version,
    payload: { kind: 'workout', data: { ...next.payload.data, exercises: [] } },
  });
  expect(() => repository.apply('owner', removal)).toThrow();
  expect(
    repository
      .catalog('owner')
      .find((record) => record.id === workout.recordId),
  ).toEqual(retained);
});
