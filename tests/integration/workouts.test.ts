import { afterEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import type { WorkoutPlanInput } from '@/contracts/workouts';

vi.mock('server-only', () => ({}));
const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(() => connections.splice(0).forEach(({ sqlite }) => sqlite.close()));

it('keeps actual workout facts bound to their original plan through edits and deletion', () => {
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
  const input: WorkoutPlanInput = {
    title: 'Initial plan',
    description: '',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
    workouts: [
      {
        id: 'squat',
        date: '2026-10-11',
        title: 'Legs',
        exercises: [{ name: 'Squat', sets: [{ reps: 8, weightKg: 40 }] }],
      },
    ],
  };
  const plan = repository.createPlan('owner', input);
  const session = repository.createSession('owner', {
    title: 'Legs',
    date: '2026-10-11',
    exercises: [{ name: 'Squat', sets: [{ reps: 7, weightKg: 35 }] }],
    status: 'completed',
    note: 'Hard',
    planId: plan.id,
    plannedWorkoutId: 'squat',
  });
  const updated = repository.updatePlan('owner', plan.id, plan.revision, {
    ...input,
    workouts: [
      {
        ...input.workouts[0]!,
        exercises: [{ name: 'Press', sets: [{ reps: 12, weightKg: 60 }] }],
      },
    ],
  });
  repository.deletePlan('owner', updated.id, updated.revision);

  const saved = repository.updateSession(
    'owner',
    session.id,
    session.revision,
    {
      ...session,
      exercises: session.exercises,
      note: 'Corrected',
    },
  );
  expect(saved.planSnapshot?.planTitle).toBe('Initial plan');
  expect(saved.planSnapshot?.workout.exercises[0]?.sets[0]?.weightKg).toBe(40);
  expect(saved.exercises[0]?.sets[0]?.weightKg).toBe(35);
  expect(repository.list('another-owner').plans).toEqual([]);
});
