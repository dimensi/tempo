import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import type {
  WorkoutPlanInput,
  WorkoutSessionCreate,
} from '@/contracts/workouts';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const api = await import('@/server/workouts');
const repository = workoutRepository(database.db);
const headers = new Headers();
const planInput: WorkoutPlanInput = {
  title: 'Начальный план',
  description: '',
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  workouts: [
    {
      id: 'squat',
      date: '2026-10-11',
      title: 'Ноги',
      exercises: [{ name: 'Приседание', sets: [{ reps: 8, weightKg: 40 }] }],
    },
  ],
};
const actual: WorkoutSessionCreate = {
  title: 'Ноги',
  date: '2026-10-11',
  exercises: [{ name: 'Приседание', sets: [{ reps: 7, weightKg: 35 }] }],
  status: 'completed',
  note: 'Тяжело',
};
beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
  // Feature-owned test DDL only; coordinator generates deployment migrations.
  database.sqlite
    .exec(`CREATE TABLE IF NOT EXISTS workout_plans (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workout_sessions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, data TEXT NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
  ] as const)
    database.db
      .insert(user)
      .values({
        id,
        role,
        name: id,
        email: `${id}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
});
afterAll(() => database.sqlite.close());
it('preserves actual and original plan snapshot across edits/deletion and actual correction', () => {
  const plan = repository.createPlan('owner', planInput);
  const session = repository.createSession('owner', {
    ...actual,
    planId: plan.id,
    plannedWorkoutId: 'squat',
  });
  const updated = repository.updatePlan('owner', plan.id, 1, {
    ...planInput,
    title: 'Новый план',
    workouts: [
      {
        ...planInput.workouts[0]!,
        exercises: [{ name: 'Жим', sets: [{ reps: 12, weightKg: 60 }] }],
      },
    ],
  });
  repository.deletePlan('owner', updated.id, updated.revision);
  const corrected = repository.updateSession(
    'owner',
    session.id,
    session.revision,
    { ...actual, note: 'Исправлена заметка' },
  );
  expect(corrected.planSnapshot?.planTitle).toBe('Начальный план');
  expect(corrected.planSnapshot?.workout.exercises[0]?.sets[0]?.weightKg).toBe(
    40,
  );
  expect(corrected.exercises[0]?.sets[0]?.weightKg).toBe(35);
  expect(corrected.note).toBe('Исправлена заметка');
});
it('enforces owner query scope, optimistic revisions and refuses nonexistent plan targets', () => {
  const plan = repository.createPlan('owner', planInput);
  expect(repository.list('other-owner').plans).toEqual([]);
  expect(() =>
    repository.updatePlan('other-owner', plan.id, 1, planInput),
  ).toThrow();
  repository.updatePlan('owner', plan.id, 1, planInput);
  expect(() => repository.updatePlan('owner', plan.id, 1, planInput)).toThrow();
  expect(() => repository.deletePlan('owner', plan.id, 1)).toThrow();
  expect(() =>
    repository.createSession('owner', {
      ...actual,
      planId: plan.id,
      plannedWorkoutId: 'missing',
    }),
  ).toThrow();
  const session = repository.createSession('owner', actual);
  expect(() =>
    repository.updateSession('other-owner', session.id, 1, actual),
  ).toThrow();
  repository.updateSession('owner', session.id, 1, actual);
  expect(() => repository.deleteSession('owner', session.id, 1)).toThrow();
});
it('real authorization allows granted trainer plans, rejects trainer actual writes and revoked/foreign owner reads', async () => {
  state.session = null;
  await expect(api.listWorkouts(headers, 'owner')).rejects.toMatchObject({
    status: 401,
  });
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(
    api.createWorkoutPlan(headers, 'owner', planInput),
  ).rejects.toMatchObject({ status: 403 });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  const plan = await api.createWorkoutPlan(headers, 'owner', planInput);
  await expect(
    api.updateWorkoutPlan(headers, 'owner', plan.id, 1, planInput),
  ).resolves.toMatchObject({ revision: 2 });
  await expect(
    api.createWorkoutSession(headers, 'owner', actual),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.updateWorkoutSession(headers, 'owner', 'any', 1, actual),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.deleteWorkoutSession(headers, 'owner', 'any', 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(api.listWorkouts(headers, 'other-owner')).rejects.toMatchObject({
    status: 403,
  });
  database.db.delete(trainerAccess).run();
  await expect(api.listWorkouts(headers, 'owner')).rejects.toMatchObject({
    status: 403,
  });
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  await expect(api.listWorkouts(headers, 'other-owner')).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    api.createWorkoutSession(headers, 'owner', actual),
  ).resolves.toMatchObject({ status: 'completed' });
});
