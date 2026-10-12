import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { workoutRepository } from '@/server/workouts/repository';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import { serializeOwner } from '@/server/workouts/transformmate/engine';
import type { WorkoutPlanInput } from '@/contracts/workouts';
import {
  TransformMateStorageError,
  TransformMateStaleConnectionError,
} from '@/server/transformmate/token-store';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  sessionRead: vi.fn(),
  client: vi.fn(),
  fence: vi.fn(),
  binding: vi.fn(),
  configured: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: () => state.sessionRead() } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateClient: state.client,
  getTransformMateConnectionFence: state.fence,
  getTransformMateBindingFence: state.binding,
  isTransformMateConfigured: state.configured,
}));
const api = await import('@/server/workouts/transformmate/service');
const workoutsApi = await import('@/server/workouts');
const headers = new Headers();
const nativeQuery = {
  from: '2026-01-01',
  to: '2026-01-31',
  limit: 20,
};
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
beforeEach(() => {
  state.sessionRead.mockReset().mockImplementation(async () => state.session);
  state.client.mockReset().mockResolvedValue(null);
  state.fence.mockReset().mockResolvedValue(null);
  state.binding.mockReset().mockResolvedValue({
    configured: false,
    accountScope: null,
    assertCurrent: vi.fn(async () => {}),
    assertBindingCurrent: vi.fn(),
  });
  state.configured.mockReset().mockResolvedValue(false);
});
afterAll(() => database.sqlite.close());

it('requires a real owner-scoped grant for local-only list, refresh and saving links', async () => {
  const plan = repository.createPlan('owner', input);
  await expect(
    api.listTransformMateSync(headers, 'owner', nativeQuery),
  ).rejects.toMatchObject({ status: 401 });
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  for (const run of [
    () => api.listTransformMateSync(headers, 'owner', nativeQuery),
    () => api.refreshTransformMateSync(headers, 'owner', nativeQuery),
    () => api.syncSavedPlan(headers, 'owner', plan),
  ])
    await expect(run()).rejects.toMatchObject({ status: 403 });
  database.db
    .insert(trainerAccess)
    .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
    .run();
  await api.syncSavedPlan(headers, 'owner', plan);
  const data = await api.listTransformMateSync(headers, 'owner', nativeQuery);
  expect(data.configured).toBe(false);
  expect(data.items).toHaveLength(1);
  expect(data.items[0]!.reason).toBe('not_configured');
  expect(data.items[0]!.planSnapshot).toEqual({
    planTitle: input.title,
    workout: input.workouts[0],
  });
  await expect(
    api.listTransformMateSync(headers, 'other-owner', nativeQuery),
  ).rejects.toMatchObject({ status: 403 });
  database.db.delete(trainerAccess).run();
  await expect(
    api.listTransformMateSync(headers, 'owner', nativeQuery),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.refreshTransformMateSync(headers, 'owner', nativeQuery),
  ).rejects.toMatchObject({ status: 403 });
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  await expect(
    api.listTransformMateSync(headers, 'other-owner', nativeQuery),
  ).rejects.toMatchObject({ status: 403 });
});

it.each(['disconnect', 'reconnect'] as const)(
  'does not release a stale native response after %s during final authorization',
  async () => {
    state.session = { user: { id: 'owner', role: 'OWNER' } };
    let revision = 0;
    const capturedRevision = revision;
    let afterConnectionFence = false;
    let heldFinalAccess = false;
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.binding.mockResolvedValue({
      configured: true,
      accountScope: 'a'.repeat(64),
      assertCurrent: vi.fn(async () => {
        afterConnectionFence = true;
      }),
      assertBindingCurrent: vi.fn(() => {
        if (revision !== capturedRevision)
          throw new TransformMateStaleConnectionError();
      }),
    });
    state.sessionRead.mockImplementation(async () => {
      if (afterConnectionFence && !heldFinalAccess) {
        heldFinalAccess = true;
        entered();
        await gate;
      }
      return state.session;
    });

    const operation = api.listTransformMateSync(headers, 'owner', nativeQuery);
    await ready;
    revision += 1;
    release();

    await expect(operation).rejects.toBeInstanceOf(
      TransformMateStaleConnectionError,
    );
  },
);
it('retains latest unattempted link snapshots after local edits and deletion; list does no upstream read', async () => {
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
  const data = await api.refreshTransformMateSync(
    headers,
    'owner',
    nativeQuery,
  );
  const link = data.items.find((item) => item.planId === plan.id)!;
  expect(link.planSnapshot.planTitle).toBe('Updated');
  expect(link.planSnapshot.workout.title).toBe('Changed workout');
  expect(
    syncRepository(database.db)
      .list('owner')
      .find((l) => l.planId === plan.id)!.state.attempted,
  ).toBe(false);
});
it('does not change durable intents for caller-supplied stale or missing plans', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const plan = repository.createPlan('owner', input);
  const before = syncRepository(database.db).list('owner');
  await api.syncSavedPlan(headers, 'owner', { ...plan, revision: 2 });
  await api.syncSavedPlan(headers, 'owner', { ...plan, id: 'missing' });
  expect(syncRepository(database.db).list('owner')).toEqual(before);
  expect(before.find((l) => l.planId === plan.id)?.state.attempted).toBe(false);
});

it('plan transactions reconcile pending intents but preserve every attempted snapshot', () => {
  const plan = repository.createPlan('owner', input);
  const links = syncRepository(database.db);
  const initial = links.list('owner').find((l) => l.planId === plan.id)!;
  const latest = repository.updatePlan('owner', plan.id, 1, {
    ...input,
    title: 'Latest before attempt',
    workouts: [
      {
        ...input.workouts[0]!,
        title: 'Latest workout',
        exercises: [
          {
            ...input.workouts[0]!.exercises[0]!,
            comment: 'Latest comment',
            sets: [{ reps: 11, weightKg: 14 }],
          },
        ],
      },
    ],
  });
  const pending = links.list('owner').find((l) => l.planId === plan.id)!;
  expect(pending.revision).toBe(initial.revision + 1);
  expect(pending.state.planTitle).toBe('Latest before attempt');
  expect(pending.state.workout.exercises[0]!.sets[0]!.reps).toBe(11);
  expect(pending.state.marker).toBe(initial.state.marker);
  expect(
    links.cas(initial, {
      ...initial.state,
      attempted: true,
      status: 'unknown',
    }),
  ).toBeNull();
  const attempted = links.cas(pending, {
    ...pending.state,
    attempted: true,
    status: 'unknown',
    reason: 'ambiguous_write',
  })!;
  repository.updatePlan('owner', latest.id, latest.revision, {
    ...input,
    title: 'After attempt',
  });
  const after = links.list('owner').find((l) => l.planId === plan.id)!;
  expect(after).toEqual(attempted);
  repository.deletePlan('owner', latest.id, latest.revision + 1);
  expect(
    links.list('owner').find((l) => l.planId === plan.id)!.state.planTitle,
  ).toBe('Latest before attempt');
});

it('serializes competing plan saves and only commits the current local revision to a pending intent', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const plan = await workoutsApi.createWorkoutPlan(headers, 'owner', input);
  const first = {
    ...input,
    title: 'First queued edit',
    workouts: [{ ...input.workouts[0]!, title: 'Latest queued workout' }],
  };
  const second = { ...input, title: 'Stale concurrent edit' };
  const results = await Promise.allSettled([
    workoutsApi.updateWorkoutPlan(
      headers,
      'owner',
      plan.id,
      plan.revision,
      first,
    ),
    workoutsApi.updateWorkoutPlan(
      headers,
      'owner',
      plan.id,
      plan.revision,
      second,
    ),
  ]);
  expect(results[0]).toMatchObject({
    status: 'fulfilled',
    value: { title: first.title, revision: 2 },
  });
  expect(results[1]).toMatchObject({
    status: 'rejected',
    reason: { status: 409 },
  });
  const current = syncRepository(database.db)
    .list('owner')
    .find((link) => link.planId === plan.id)!;
  expect(current.state.planTitle).toBe(first.title);
  expect(current.state.workout.title).toBe('Latest queued workout');
  expect(current.state.attempted).toBe(false);
  expect(current.remoteTrainingId).toBeNull();
});

it('rechecks plan permission after waiting in the owner queue before any local save', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocker = serializeOwner('owner', async () => {
    started();
    await gate;
  });
  await ready;
  let saved = false;
  const before = repository.list('owner');
  const operation = api.saveAndSyncWorkoutPlan(headers, 'owner', () => {
    saved = true;
    return repository.createPlan('owner', input);
  });
  state.session = null;
  release();
  await expect(operation).rejects.toMatchObject({ status: 401 });
  await blocker;
  expect(saved).toBe(false);
  expect(repository.list('owner')).toEqual(before);
});

it('preserves a permitted local save while encrypted storage is unavailable', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  state.fence.mockRejectedValueOnce(new TransformMateStorageError());
  const plan = await api.saveAndSyncWorkoutPlan(headers, 'owner', () =>
    repository.createPlan('owner', { ...input, title: 'Local during outage' }),
  );
  expect(
    repository.list('owner').plans.find((p) => p.id === plan.id)?.title,
  ).toBe('Local during outage');
  expect(state.client).not.toHaveBeenCalled();
  state.configured.mockRejectedValueOnce(new TransformMateStorageError());
  expect(
    (await api.listTransformMateSync(headers, 'owner', nativeQuery)).configured,
  ).toBe(false);
});

it('does not turn a stale connection into permission for a late local write', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  state.fence.mockRejectedValueOnce(new TransformMateStaleConnectionError());
  const save = vi.fn(() => repository.createPlan('owner', input));
  await expect(
    api.saveAndSyncWorkoutPlan(headers, 'owner', save),
  ).rejects.toBeInstanceOf(TransformMateStaleConnectionError);
  expect(save).not.toHaveBeenCalled();
});

it('rechecks authorization before falling back from a failed storage read', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  state.fence.mockImplementationOnce(async () => {
    state.session = null;
    throw new TransformMateStorageError();
  });
  const save = vi.fn(() => repository.createPlan('owner', input));
  await expect(
    api.saveAndSyncWorkoutPlan(headers, 'owner', save),
  ).rejects.toMatchObject({
    status: 401,
  });
  expect(save).not.toHaveBeenCalled();
});

for (const revoked of ['session', 'grant'] as const) {
  it(`rejects ${revoked} revocation during the final connection fence before SQL save or intent`, async () => {
    state.session = { user: { id: 'trainer', role: 'TRAINER' } };
    database.db
      .insert(trainerAccess)
      .values({ trainerId: 'trainer', ownerId: 'owner', createdAt: new Date() })
      .run();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const assertCurrent = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        entered();
        await gate;
      });
    state.fence.mockResolvedValue({
      client: null,
      generation: 'synthetic-connection',
      assertCurrent,
      assertBindingCurrent: vi.fn(),
    });
    const beforePlans = repository.list('owner');
    const beforeLinks = syncRepository(database.db).list('owner');
    const save = vi.fn(() => repository.createPlan('owner', input));
    const operation = api.saveAndSyncWorkoutPlan(headers, 'owner', save);
    await ready;
    if (revoked === 'session') state.session = null;
    else database.db.delete(trainerAccess).run();
    release();
    await expect(operation).rejects.toMatchObject({
      status: revoked === 'session' ? 401 : 403,
    });
    expect(save).not.toHaveBeenCalled();
    expect(repository.list('owner')).toEqual(beforePlans);
    expect(syncRepository(database.db).list('owner')).toEqual(beforeLinks);
    database.db.delete(trainerAccess).run();
  });
}

it('keeps a disconnected snapshot local instead of acquiring an unfenced newly connected client', async () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
  const createTraining = vi.fn();
  state.client.mockResolvedValue({ createTraining });
  state.fence.mockImplementationOnce(async () => {
    // Connection appears after the runtime captured a coherent disconnected snapshot.
    state.configured.mockResolvedValue(true);
    return null;
  });
  const plan = await api.saveAndSyncWorkoutPlan(headers, 'owner', () =>
    repository.createPlan('owner', input),
  );
  const link = syncRepository(database.db)
    .list('owner')
    .find((item) => item.planId === plan.id)!;
  expect(state.client).not.toHaveBeenCalled();
  expect(createTraining).not.toHaveBeenCalled();
  expect(link.state.attempted).toBe(false);
  expect(link.remoteTrainingId).toBeNull();
  expect(link.state.actual).toBeNull();
});
