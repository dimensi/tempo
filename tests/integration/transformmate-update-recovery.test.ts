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
import {
  remoteProjection,
  projectionFingerprint,
  updateProjection,
} from '@/server/workouts/transformmate/mapping';
import { workoutPlanInputSchema } from '@/contracts/workouts';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import { transformMateExerciseDetailSchema } from '@/server/transformmate/exercise-schema';
import type { RawResponse } from '@/server/transformmate/types';
import type { TrainingWriteBody } from '@/server/transformmate/write-inputs';
vi.mock('server-only', () => ({}));
const raw = <T>(body: T): RawResponse<T> => ({
  body,
  status: 200,
  statusText: 'OK',
  isJson: true,
  contentType: 'application/json',
});
const input = () =>
  workoutPlanInputSchema.parse({
    title: 'Synthetic',
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
            comment: 'Demo comment',
            transformMate: { exerciseId: 501, occurrenceKey: randomUUID() },
            sets: [{ reps: 8, weightKg: 10 }],
          },
        ],
      },
    ],
  });
function initialize(url: string) {
  const database = openDatabase(url);
  migrate(database.db, { migrationsFolder: './drizzle' });
  database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic',
      role: 'OWNER',
      email: 'synthetic@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  const plan = workoutRepository(database.db).createPlan('owner', input());
  const links = syncRepository(database.db);
  const link = links.list('owner')[0]!;
  const detail = transformMateTrainingDetailSchema.parse({
    ...trainingDetailFixture(),
    description: link.state.marker,
  });
  links.cas(
    link,
    {
      ...link.state,
      attempted: true,
      status: 'synced',
      baseline: remoteProjection(detail),
      published: {
        workout: plan.workouts[0]!,
        planTitle: plan.title,
        authorId: detail.author,
      },
    },
    detail.id,
  );
  return { database, plan, detail };
}
function catalog() {
  const e = exerciseDetailFixture();
  e.metrics = [3, 4].map((id) => ({
    ...e.metrics[0]!,
    id,
    key: id === 3 ? 'weight' : 'reps',
    set_metric_types: [
      { name: 'Straight', type: 'straight', key: '', friendly_techniques: [] },
    ],
  }));
  return transformMateExerciseDetailSchema.parse(e);
}

it.each([true, false])(
  'file-backed restart only reads an unknown PATCH committed=%s and preserves attempted snapshots',
  async (committed) => {
    const directory = mkdtempSync(join(tmpdir(), 'transformmate-update-'));
    const url = `file:${join(directory, 'synthetic.sqlite')}`;
    const initial = initialize(url);
    let database = initial.database;
    let detail = initial.detail;
    let failReads = false;
    try {
      const edited = {
        ...input(),
        workouts: [{ ...initial.plan.workouts[0]!, title: 'Desired' }],
      };
      workoutRepository(database.db).updatePlan(
        'owner',
        initial.plan.id,
        1,
        edited,
      );
      let patches = 0;
      const client = {
        getExercise: async () => raw(catalog()),
        createTraining: async () => {
          throw new Error('No create');
        },
        listTrainings: async () =>
          raw([
            { ...trainingSummaryFixture(), description: detail.description },
          ]),
        getTraining: async () => {
          if (failReads) throw new Error('Read failed');
          return raw(detail);
        },
        updateTrainingOnce: async (_id: number, body: TrainingWriteBody) => {
          patches++;
          if (committed) detail = { ...detail, name: body.name };
          failReads = true;
          throw new Error('Ambiguous response');
        },
      };
      const run = () => {
        const links = syncRepository(database.db);
        return syncEngine({
          repository: links,
          client,
          access: async () => {},
          plans: () => workoutRepository(database.db).list('owner').plans,
        }).process(links.list('owner')[0]!);
      };
      await run();
      let attempt = syncRepository(database.db).list('owner')[0]!.state
        .updateAttempt!;
      expect(attempt.phase).toBe('unknown');
      expect(patches).toBe(1);
      expect(attempt.previous.workout.title).toBe('Demo training');
      expect(attempt.desired.workout.title).toBe('Desired');
      database.sqlite.close();
      database = openDatabase(url);
      failReads = false;
      if (!committed) {
        workoutRepository(database.db).updatePlan('owner', initial.plan.id, 2, {
          ...edited,
          workouts: [{ ...edited.workouts[0]!, title: 'Later local' }],
        });
      }
      await run();
      await run();
      expect(patches).toBe(1);
      attempt = syncRepository(database.db).list('owner')[0]!.state
        .updateAttempt!;
      expect(attempt.phase).toBe(committed ? 'verified' : 'unknown');
      expect(
        syncRepository(database.db).list('owner')[0]!.state.workout.title,
      ).toBe('Demo training');
    } finally {
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
it.each([false, true])(
  'restart after durable pending/claimed update claimed=%s never confuses the mutation phase',
  async (claimed) => {
    const directory = mkdtempSync(join(tmpdir(), 'transformmate-claim-'));
    const url = `file:${join(directory, 'synthetic.sqlite')}`;
    const initial = initialize(url);
    let database = initial.database;
    let detail = initial.detail;
    try {
      workoutRepository(database.db).updatePlan('owner', initial.plan.id, 1, {
        ...input(),
        workouts: [{ ...initial.plan.workouts[0]!, title: 'Desired' }],
      });
      if (claimed) {
        const links = syncRepository(database.db);
        const link = links.list('owner')[0]!;
        const attempt = link.state.updateAttempt!;
        const prepared = updateProjection(
          detail,
          attempt.previous.workout,
          attempt.desired.workout,
        );
        links.cas(link, {
          ...link.state,
          status: 'unknown',
          reason: 'ambiguous_write',
          updateAttempt: {
            ...attempt,
            phase: 'unknown',
            expectedFingerprint: projectionFingerprint(prepared.projection),
          },
        });
      }
      database.sqlite.close();
      database = openDatabase(url);
      let patches = 0;
      const links = syncRepository(database.db);
      const client = {
        getExercise: async () => raw(catalog()),
        createTraining: async () => {
          throw new Error('No create');
        },
        listTrainings: async () => raw([]),
        getTraining: async () => raw(detail),
        updateTrainingOnce: async (_id: number, body: TrainingWriteBody) => {
          patches++;
          detail = { ...detail, name: body.name };
          return raw({ id: 101 });
        },
      };
      const engine = syncEngine({
        repository: links,
        client,
        access: async () => {},
        plans: () => workoutRepository(database.db).list('owner').plans,
      });
      await engine.process(links.list('owner')[0]!);
      expect(patches).toBe(claimed ? 0 : 1);
      expect(links.list('owner')[0]!.state.updateAttempt!.phase).toBe(
        claimed ? 'unknown' : 'verified',
      );
    } finally {
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
it('atomic local edit rolls back if the durable pending update intent cannot be recorded', () => {
  const initialized = initialize('file::memory:');
  const { database, plan } = initialized;
  try {
    const before = syncRepository(database.db).list('owner')[0]!;
    database.sqlite.exec(
      "CREATE TRIGGER synthetic_update_failure BEFORE UPDATE ON workout_transformmate_links BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() =>
      workoutRepository(database.db).updatePlan('owner', plan.id, 1, {
        ...input(),
        workouts: [{ ...plan.workouts[0]!, title: 'Edited' }],
      }),
    ).toThrow();
    expect(workoutRepository(database.db).list('owner').plans[0]).toEqual(plan);
    expect(syncRepository(database.db).list('owner')[0]).toEqual(before);
  } finally {
    database.sqlite.close();
  }
});
