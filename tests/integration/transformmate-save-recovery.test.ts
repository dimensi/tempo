import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import { syncEngine } from '@/server/workouts/transformmate/engine';
import { workoutPlanInputSchema } from '@/contracts/workouts';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import type { RawResponse } from '@/server/transformmate/types';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
vi.mock('server-only', () => ({}));
const input = () =>
  workoutPlanInputSchema.parse({
    title: 'Synthetic recovery plan',
    description: '',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    workouts: [
      {
        id: 'workout',
        date: '2026-01-01',
        title: 'Demo training',
        exercises: [
          {
            name: 'Demo exercise',
            transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
            comment: 'Demo comment',
            sets: [{ reps: 8, weightKg: 10 }],
          },
        ],
      },
    ],
  });
const raw = <T>(body: T): RawResponse<T> => ({
  body,
  status: 200,
  statusText: 'OK',
  isJson: true,
  contentType: 'application/json',
});

it('recovers an intent committed with a plan after process restart and reconciles a committed timeout without POST duplication', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'transformmate-recovery-'));
  const url = `file:${join(directory, 'synthetic.sqlite')}`;
  let database = openDatabase(url);
  try {
    migrate(database.db, { migrationsFolder: './drizzle' });
    database.db
      .insert(user)
      .values({
        id: 'owner',
        name: 'Synthetic',
        role: 'OWNER',
        email: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    workoutRepository(database.db).createPlan('owner', input(), randomUUID());
    expect(syncRepository(database.db).list('owner')).toHaveLength(1);
    database.sqlite.close(); // Simulate process stopping before any HTTP work.
    database = openDatabase(url);
    const links = syncRepository(database.db);
    const link = links.list('owner')[0]!;
    expect(link.state.attempted).toBe(false);
    const detail = trainingDetailFixture();
    detail.description = link.state.marker;
    detail.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.set_metrics =
      detail.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.set_metrics.slice();
    const exercise = exerciseDetailFixture();
    exercise.metrics = [
      {
        ...exercise.metrics[0]!,
        set_metric_types: [
          {
            name: 'Straight',
            type: 'straight',
            key: '',
            friendly_techniques: [],
          },
        ],
      },
      {
        ...exercise.metrics[0]!,
        id: 4,
        key: 'reps',
        set_metric_types: [
          {
            name: 'Straight',
            type: 'straight',
            key: '',
            friendly_techniques: [],
          },
        ],
      },
    ];
    let posts = 0;
    const client = {
      getExercise: async () => raw(exercise),
      createTraining: async () => {
        posts++;
        throw new Error('Synthetic committed timeout');
      },
      listTrainings: async () =>
        raw([{ ...trainingSummaryFixture(), description: detail.description }]),
      getTraining: async () =>
        raw(transformMateTrainingDetailSchema.parse(detail)),
    };
    const engine = syncEngine({
      repository: links,
      client,
      access: async () => {},
      plans: () => workoutRepository(database.db).list('owner').plans,
    });
    await engine.process(link);
    expect(links.list('owner')[0]!.state.status).toBe('synced');
    expect(posts).toBe(1);
    database.sqlite.close();
    database = openDatabase(url);
    const resumed = syncRepository(database.db);
    await syncEngine({
      repository: resumed,
      client,
      access: async () => {},
      plans: () => workoutRepository(database.db).list('owner').plans,
    }).process(resumed.list('owner')[0]!);
    expect(posts).toBe(1);
    expect(resumed.list('owner')[0]!.remoteTrainingId).toBe(101);
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('rolls back plan creation and edits if a new durable intent cannot commit', () => {
  const database = openDatabase('file::memory:');
  try {
    migrate(database.db, { migrationsFolder: './drizzle' });
    database.db
      .insert(user)
      .values({
        id: 'owner',
        name: 'Synthetic',
        role: 'OWNER',
        email: 'owner@example.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const repository = workoutRepository(database.db);
    const manual = input();
    manual.workouts[0]!.exercises = [
      { name: 'Manual', sets: [{ reps: 10, weightKg: null }] },
    ];
    const plan = repository.createPlan('owner', manual);
    database.sqlite.exec(
      "CREATE TRIGGER synthetic_link_failure BEFORE INSERT ON workout_transformmate_links BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() => repository.createPlan('owner', input())).toThrow();
    expect(() =>
      repository.updatePlan('owner', plan.id, plan.revision, input()),
    ).toThrow();
    expect(repository.list('owner').plans).toEqual([plan]);
    expect(syncRepository(database.db).list('owner')).toEqual([]);
  } finally {
    database.sqlite.close();
  }
});
