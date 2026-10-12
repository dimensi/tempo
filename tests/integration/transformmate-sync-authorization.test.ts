import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import type { WorkoutPlanInput } from '@/contracts/workouts';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateClient: () => null,
  isTransformMateConfigured: () => false,
}));
const api = await import('@/server/workouts/transformmate/service');
const headers = new Headers();
const repository = workoutRepository(database.db);
const input: WorkoutPlanInput = {
  title: 'Original plan',
  description: '',
  startsOn: '2026-01-01',
  endsOn: '2026-01-01',
  workouts: [
    {
      id: 'demo-workout',
      date: '2026-01-01',
      title: 'Demo training',
      exercises: [
        {
          name: 'Demo',
          transformMate: {
            exerciseId: 501,
            occurrenceKey: '8a94d856-322e-4f4b-b35d-e7aee12db03e',
          },
          sets: [{ reps: 8, weightKg: 10 }],
        },
      ],
    },
  ],
};
beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
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
it('requires a real owner-scoped grant for local-only list, refresh and saving links', async () => {
  const plan = repository.createPlan('owner', input);
  await expect(
    api.listTransformMateSync(headers, 'owner'),
  ).rejects.toMatchObject({ status: 401 });
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  for (const run of [
    () => api.listTransformMateSync(headers, 'owner'),
    () => api.refreshTransformMateSync(headers, 'owner'),
    () => api.syncSavedPlan(headers, 'owner', plan),
  ])
    await expect(run()).rejects.toMatchObject({ status: 403 });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  await api.syncSavedPlan(headers, 'owner', plan);
  const data = await api.listTransformMateSync(headers, 'owner');
  expect(data.configured).toBe(false);
  expect(data.items).toHaveLength(1);
  expect(data.items[0]!.reason).toBe('not_configured');
  expect(data.items[0]!.planSnapshot).toEqual({
    planTitle: input.title,
    workout: input.workouts[0],
  });
  await expect(
    api.listTransformMateSync(headers, 'other-owner'),
  ).rejects.toMatchObject({ status: 403 });
  database.db.delete(trainerAccess).run();
  await expect(
    api.listTransformMateSync(headers, 'owner'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.refreshTransformMateSync(headers, 'owner'),
  ).rejects.toMatchObject({ status: 403 });
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  await expect(
    api.listTransformMateSync(headers, 'other-owner'),
  ).rejects.toMatchObject({ status: 403 });
});
it('retains original link snapshots through local edits and deletion; list does no upstream read', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const plan = repository.createPlan('owner', input);
  await api.syncSavedPlan(headers, 'owner', plan);
  const updated = repository.updatePlan('owner', plan.id, 1, {
    ...input,
    title: 'Updated',
    workouts: [{ ...input.workouts[0]!, title: 'Changed workout' }],
  });
  await api.syncSavedPlan(headers, 'owner', updated);
  repository.deletePlan('owner', plan.id, updated.revision);
  const data = await api.refreshTransformMateSync(headers, 'owner');
  const link = data.items.find((item) => item.planId === plan.id)!;
  expect(link.planSnapshot.planTitle).toBe('Original plan');
  expect(link.planSnapshot.workout.title).toBe('Demo training');
  expect(
    syncRepository(database.db)
      .list('owner')
      .find((l) => l.planId === plan.id)!.state.attempted,
  ).toBe(false);
});
it('does not persist caller-supplied or stale/foreign plans', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const plan = repository.createPlan('owner', input);
  await api.syncSavedPlan(headers, 'owner', { ...plan, revision: 2 });
  await api.syncSavedPlan(headers, 'owner', { ...plan, id: 'missing' });
  expect(
    syncRepository(database.db)
      .list('owner')
      .find((l) => l.planId === plan.id),
  ).toBeUndefined();
});
