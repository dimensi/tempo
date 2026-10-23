import { afterEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import type { Workout, WorkoutInput } from '@/contracts/workouts';
import { copyWorkoutToDate } from '@/features/workouts/copy-workout';
import { workoutDraftSchema } from '@/features/workouts/workout-draft';

vi.mock('server-only', () => ({}));
const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => connections.splice(0).forEach(({ sqlite }) => sqlite.close()));
const data = ({
  date,
  title,
  note,
  status,
  exercises,
}: Workout): WorkoutInput => ({ date, title, note, status, exercises });

it('retains one workout identity and its edited values through guarded lifecycle transitions', () => {
  const database = openDatabase('file::memory:');
  connections.push(database);
  migrate(database.db, { migrationsFolder: './drizzle' });
  database.db
    .insert(user)
    .values({
      id: 'owner',
      role: 'OWNER',
      name: 'Owner',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  const repository = workoutRepository(database.db);
  const input: WorkoutInput = {
    title: 'Legs',
    date: '2026-10-11',
    note: '',
    status: 'planned',
    exercises: [],
  };
  const created = repository.create('owner', input, crypto.randomUUID());
  expect(() =>
    repository.update(
      'owner',
      created.id,
      created.revision,
      { ...input, status: 'in_progress' },
      'start',
    ),
  ).toThrow();
  const planned = repository.update('owner', created.id, created.revision, {
    ...input,
    exercises: [
      {
        id: crypto.randomUUID(),
        name: 'Squat',
        sets: [{ reps: 10, weightKg: 60 }],
      },
    ],
  });
  const started = repository.update(
    'owner',
    planned.id,
    planned.revision,
    { ...data(planned), status: 'in_progress' },
    'start',
  );
  expect(started.id).toBe(created.id);
  expect(started.exercises).toEqual(planned.exercises);
  const completedData: WorkoutInput = {
    ...data(started),
    status: 'completed',
    exercises: started.exercises.map((e) => ({
      ...e,
      sets: [{ reps: 8, weightKg: 55 }],
    })),
  };
  const requestId = crypto.randomUUID();
  const completed = repository.update(
    'owner',
    started.id,
    started.revision,
    completedData,
    'complete',
    requestId,
  );
  const copySource: Workout = {
    ...completed,
    legacySource: { planId: 'old-plan', workoutId: 'old-workout' },
  };
  const copied = copyWorkoutToDate(copySource, '2026-10-12');
  expect(workoutDraftSchema.parse(copied)).toMatchObject({
    date: '2026-10-12',
    title: completed.title,
    note: completed.note,
    status: 'planned',
  });
  expect(copied.exercises[0]?.id).not.toBe(completed.exercises[0]?.id);
  expect(copied.exercises[0]?.sets).toEqual(completed.exercises[0]?.sets);
  expect(
    repository.update(
      'owner',
      started.id,
      started.revision,
      completedData,
      'complete',
      requestId,
    ),
  ).toEqual(completed);
  expect(() =>
    repository.update('owner', completed.id, completed.revision, {
      ...completedData,
      note: 'forbidden',
    }),
  ).toThrow();
  expect(() =>
    repository.update(
      'owner',
      completed.id,
      completed.revision,
      { ...completedData, status: 'in_progress', note: 'changed' },
      'resume',
    ),
  ).toThrow();
  const resumed = repository.update(
    'owner',
    completed.id,
    completed.revision,
    { ...completedData, status: 'in_progress' },
    'resume',
  );
  expect(resumed.exercises[0]?.sets).toEqual([{ reps: 8, weightKg: 55 }]);
  expect(repository.list('owner').workouts).toHaveLength(1);
  expect(repository.list('another-owner').workouts).toEqual([]);
  expect(() => repository.get('another-owner', created.id)).toThrow();
  expect(() =>
    repository.update('owner', created.id, started.revision, {
      ...completedData,
      status: 'in_progress',
    }),
  ).toThrow();
});
