import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { syncEngine } from '@/server/workouts/transformmate/engine';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import { workoutPlanInputSchema } from '@/contracts/workouts';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import type { RawResponse } from '@/server/transformmate/types';

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

it('recovers a committed TransformMate create after restart without duplicating the POST', async () => {
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
    database.sqlite.close();
    database = openDatabase(url);
    const links = syncRepository(database.db);
    const link = links.list('owner')[0]!;
    const detail = trainingDetailFixture();
    detail.description = link.state.marker;
    const exercise = exerciseDetailFixture();
    exercise.metrics = [3, 4].map((id) => ({
      ...exercise.metrics[0]!,
      id,
      key: id === 3 ? 'weight' : 'reps',
      set_metric_types: [
        {
          name: 'Straight',
          type: 'straight',
          key: '',
          friendly_techniques: [],
        },
      ],
    }));
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
    const engine = () =>
      syncEngine({
        repository: syncRepository(database.db),
        client,
        access: async () => {},
        plans: () => workoutRepository(database.db).list('owner').plans,
      });
    await engine().process(link);
    expect(posts).toBe(1);
    expect(links.list('owner')[0]?.state.status).toBe('synced');

    database.sqlite.close();
    database = openDatabase(url);
    const resumed = syncRepository(database.db).list('owner')[0]!;
    await engine().process(resumed);
    expect(posts).toBe(1);
    expect(syncRepository(database.db).list('owner')[0]?.remoteTrainingId).toBe(
      101,
    );
  } finally {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
