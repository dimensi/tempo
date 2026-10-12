import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { workoutPlanInputSchema } from '@/contracts/workouts';
vi.mock('server-only', () => ({}));
const database = openDatabase('file::memory:');
migrate(database.db, { migrationsFolder: './drizzle' });
database.db
  .insert(user)
  .values({
    id: 'owner',
    role: 'OWNER',
    name: 'Synthetic',
    email: 'owner@example.test',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  .run();
const repository = workoutRepository(database.db);
const data = workoutPlanInputSchema.parse({
  title: 'Synthetic plan',
  description: '',
  startsOn: '2026-10-12',
  endsOn: '2026-10-12',
  workouts: [
    {
      id: 'workout',
      date: '2026-10-12',
      title: 'Workout',
      exercises: [{ name: 'Manual', sets: [{ reps: 10, weightKg: null }] }],
    },
  ],
});
afterAll(() => database.sqlite.close());
it('returns the same saved plan on same-key retry and blocks changed or foreign scoped retries', () => {
  const key = randomUUID();
  const first = repository.createPlan('owner', data, key);
  expect(repository.createPlan('owner', data, key)).toEqual(first);
  expect(repository.list('owner').plans).toHaveLength(1);
  expect(() =>
    repository.createPlan('owner', { ...data, title: 'Changed' }, key),
  ).toThrow();
  expect(() => repository.createPlan('foreign', data, key)).toThrow();
});
it('rejects duplicate linked exercise occurrence identity without changing manual input', () => {
  const transformMate = { exerciseId: 6, occurrenceKey: randomUUID() };
  const exercise = { ...data.workouts[0]!.exercises[0]!, transformMate };
  expect(
    workoutPlanInputSchema.safeParse({
      ...data,
      workouts: [{ ...data.workouts[0], exercises: [exercise, exercise] }],
    }).success,
  ).toBe(false);
  expect(workoutPlanInputSchema.safeParse(data).success).toBe(true);
});
