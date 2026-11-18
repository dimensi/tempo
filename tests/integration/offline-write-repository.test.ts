import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/server/db/schema';
import { offlineWriteRepository } from '@/server/offline/write-repository';
import { cardioRepository } from '@/server/workouts/cardio-repository';
import { normalizeYazioExercises } from '@/server/yazio/exercise-adapter';
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
  let active = repository.apply(
    'owner',
    offlineWriteSchema.parse({
      ...next,
      id: crypto.randomUUID(),
      base: retained.version,
      payload: {
        kind: 'workout',
        data: { ...next.payload.data, status: 'in_progress' },
        action: 'start',
        occurredAt: '2026-10-15T07:00:00Z',
      },
    }),
  );
  if (active.payload.kind !== 'workout') throw new Error('Expected workout');
  const completion = offlineWriteSchema.parse({
    ...next,
    id: crypto.randomUUID(),
    base: active.version,
    payload: {
      kind: 'workout',
      data: { ...active.payload.data, status: 'completed' },
      action: 'complete',
      occurredAt: '2026-10-15T07:58:30Z',
    },
  });
  active = repository.apply('owner', completion);
  if (active.payload.kind !== 'workout') throw new Error('Expected workout');
  const cardio = cardioRepository(drizzle(sqlite, { schema }));
  const day = '2026-10-15';
  const source = {
    id: 'watch-session',
    name: 'strengthtraining',
    date: day + ' 10:01:00',
    note: null,
    external_id: null,
    gateway: 'apple_health',
    source: null,
    duration: 58,
    distance: 0,
    energy: 250,
  };
  const collectedAt = '2026-10-16T12:00:00Z';
  const importDay = (training: (typeof source)[]) =>
    cardio.saveDay(
      'owner',
      day,
      normalizeYazioExercises(
        { training, custom_training: [] },
        day,
        'Europe/Moscow',
      ),
      collectedAt,
    );
  importDay([source, { ...source, id: 'second-candidate' }]);
  expect(
    cardio.day('owner', day).workouts.every((entry) => entry.link === null),
  ).toBe(true);
  importDay([source]);
  const watch = cardio.day('owner', day).workouts[0]!;
  expect(watch.link).toEqual({ kind: 'strength', id: workout.recordId });
  cardio.mutate('owner', {
    kind: 'update',
    input: {
      requestId: crypto.randomUUID(),
      kind: 'link',
      id: watch.id,
      revision: watch.revision,
      target: null,
    },
  });
  importDay([source]);
  expect(cardio.day('owner', day).workouts[0]?.link).toBeNull();
  const feedbackOperation = offlineWriteSchema.parse({
    ...next,
    id: crypto.randomUUID(),
    base: active.version,
    payload: {
      kind: 'workout',
      data: {
        ...active.payload.data,
        note: 'must not overwrite',
        exercises: [],
      },
      feedback: { exerciseId: exercise.id, fatigue: 9, failure: 'full' },
    },
  });
  const rated = repository.apply('owner', feedbackOperation);
  expect(repository.apply('owner', feedbackOperation)).toEqual(rated);
  expect(rated.payload).toMatchObject({
    kind: 'workout',
    data: {
      status: 'completed',
      note: '',
      exercises: [
        { ...exercise, fatigue: 9, failure: 'full' },
        next.payload.data.exercises[1],
      ],
    },
  });
  expect(() =>
    repository.apply('owner', {
      ...feedbackOperation,
      id: crypto.randomUUID(),
      base: active.version,
    }),
  ).toThrow();
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
  ).toEqual(rated);
});
