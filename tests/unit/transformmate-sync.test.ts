import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import {
  syncEngine,
  serializeOwner,
} from '@/server/workouts/transformmate/engine';
import {
  createProjection,
  expectedProjection,
  remoteProjection,
  updateProjection,
} from '@/server/workouts/transformmate/mapping';
import type { WorkoutPlan } from '@/contracts/workouts';
import {
  createTrainingInputSchema,
  type CreateTrainingInput,
  type TrainingWriteBody,
} from '@/server/transformmate/write-inputs';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import { transformMateExerciseDetailSchema } from '@/server/transformmate/exercise-schema';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
vi.mock('server-only', () => ({}));
const closes: (() => void)[] = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
});
const planFixture = (): WorkoutPlan => ({
  id: 'plan',
  ownerId: 'owner',
  revision: 1,
  title: 'Demo',
  description: '',
  startsOn: '2026-01-01',
  endsOn: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  workouts: [
    {
      id: 'workout',
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
});
function remote(body: TrainingWriteBody) {
  const fixture = trainingDetailFixture();
  return transformMateTrainingDetailSchema.parse({
    ...fixture,
    name: body.name,
    description: body.description,
    date: body.date,
    protocols: body.protocols.map((p, pi) => ({
      id: pi + 301,
      order: pi + 1,
      workout_exercises: p.workout_exercises.map((e, ei) => ({
        ...fixture.protocols[0]!.workout_exercises[0],
        id: ei + 401,
        order: ei + 1,
        exercise: { id: e.exercise, name: 'Demo exercise' },
        comment: e.comment,
        exercise_metrics: e.exercise_metrics.map((id) => ({
          id,
          name: 'Demo metric',
        })),
        metrics: e.metrics.map((m, mi) => ({
          id: mi + 701,
          type: m.type,
          sets: m.sets.map((s, si) => ({
            id: si + 801 + mi * 100,
            order: si + 1,
            techniques: [],
            ...(m.type === 'fact' ? { is_done: false } : {}),
            set_metrics: s.set_metrics.map((sm, smi) => ({
              id: smi + 600,
              type: sm.type,
              measure: {
                id: sm.measure,
                key: sm.measure === 3 ? 'weight' : 'reps',
                name: 'Demo measure',
                short_name: 'kg',
              },
              metric_values: sm.metric_values.map((v, vi) => ({
                id: vi + 1000,
                value: v.value,
              })),
            })),
          })),
        })),
      })),
    })),
  });
}
function setup() {
  const { db, sqlite } = openDatabase('file::memory:');
  closes.push(() => sqlite.close());
  sqlite.exec(`CREATE TABLE user(id TEXT PRIMARY KEY);
    INSERT INTO user VALUES ('owner'), ('other');
    CREATE TABLE workout_transformmate_links(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id), plan_id TEXT NOT NULL, workout_id TEXT NOT NULL, remote_training_id INTEGER, revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX local_unique ON workout_transformmate_links(owner_id,plan_id,workout_id);
    CREATE UNIQUE INDEX remote_unique ON workout_transformmate_links(owner_id,remote_training_id);`);
  const repository = syncRepository(db);
  const plan = planFixture();
  let plans = [plan];
  repository.ensure('owner', plan);
  const catalog = exerciseDetailFixture();
  catalog.metrics = [3, 4].map((id) => ({
    ...catalog.metrics[0]!,
    id,
    key: id === 3 ? 'weight' : 'reps',
    set_metric_types: [
      { name: 'Straight', type: 'straight', key: '', friendly_techniques: [] },
    ],
  }));
  let detail = remote(
    createProjection(
      plan.workouts[0]!,
      repository.list('owner')[0]!.state.marker,
    ),
  );
  const client = {
    getExercise: vi.fn(
      async (exerciseId: number) =>
        ({
          body: transformMateExerciseDetailSchema.parse({
            ...catalog,
            id: exerciseId,
          }),
        }) as never,
    ),
    createTraining: vi.fn(async (body: CreateTrainingInput) => {
      detail = remote(createTrainingInputSchema.parse(body));
      return { body: { id: 101 } } as never;
    }),
    listTrainings: vi.fn(
      async () =>
        ({
          body: [
            { ...trainingSummaryFixture(), description: detail.description },
          ],
        }) as never,
    ),
    getTraining: vi.fn(async () => ({ body: detail }) as never),
    updateTrainingOnce: vi.fn(
      async (
        _id: number,
        body: TrainingWriteBody,
        beforeSend?: () => Promise<void>,
      ) => {
        await beforeSend?.();
        detail = remote(body);
        return { body: { id: 101 } } as never;
      },
    ),
  };
  const access = vi.fn(
    async (permission: 'workouts:read' | 'workouts:plan') => {
      void permission;
    },
  );
  const engine = (selectedClient: typeof client | null = client) =>
    syncEngine({
      repository,
      client: selectedClient,
      access,
      plans: () => plans,
    });
  const process = () => engine().process(repository.list('owner')[0]!);
  const processFenced = (checkConnection: () => Promise<void>) =>
    syncEngine({
      repository,
      client,
      access,
      plans: () => plans,
      connectionId: 'f2366199-c98f-491c-af18-e42b258a66f1',
      checkConnection,
    }).process(repository.list('owner')[0]!);
  return {
    repository,
    plan,
    client,
    access,
    process,
    processFenced,
    engine,
    catalog,
    get detail() {
      return detail;
    },
    set detail(value) {
      detail = value;
    },
    setPlans: (next: WorkoutPlan[]) => {
      plans = next;
    },
    link: () => repository.list('owner')[0]!,
  };
}
describe('durable TransformMate sync', () => {
  it('posts one complete plan/fact payload, persists marker and remains idempotent on repeated saves', async () => {
    const s = setup();
    await s.process();
    s.repository.ensure('owner', s.plan);
    await s.process();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    const body = createTrainingInputSchema.parse(
      s.client.createTraining.mock.calls[0]![0],
    );
    expect(body.description).toBe(s.link().state.marker);
    expect(body.protocols[0]!.workout_exercises[0]!.metrics[1]).toEqual({
      type: 'fact',
      sets: [{ is_done: false, techniques: [], set_metrics: [] }],
    });
    expect(s.link().state.status).toBe('synced');
    expect(s.link().state.actual!.exercises[0]!.occurrenceKey).toBe(
      s.plan.workouts[0]!.exercises[0]!.transformMate!.occurrenceKey,
    );
  });
  it.each([true, false])(
    'timeout committed=%s remains unknown then verifies without repost',
    async (committed) => {
      const s = setup();
      s.client.createTraining.mockRejectedValue(new Error('Timeout'));
      if (!committed)
        s.client.listTrainings.mockResolvedValue({ body: [] } as never);
      await s.process();
      expect(s.link().state.status).toBe(committed ? 'synced' : 'unknown');
      await s.process();
      await s.process();
      expect(s.client.createTraining).toHaveBeenCalledTimes(1);
      expect(s.link().state.status).toBe(committed ? 'synced' : 'unknown');
    },
  );
  it('duplicate markers remain conflict without guessing or creating again', async () => {
    const s = setup();
    s.client.createTraining.mockRejectedValue(new Error('Timeout'));
    const summary = {
      ...trainingSummaryFixture(),
      description: s.link().state.marker,
    };
    s.client.listTrainings.mockResolvedValue({
      body: [summary, { ...summary, id: 102 }],
    } as never);
    await s.process();
    expect(s.link().state.status).toBe('conflict');
    expect(s.link().remoteTrainingId).toBeNull();
    expect(s.client.getTraining).not.toHaveBeenCalled();
  });
  it('claims before POST and preserves known ID when verification fails', async () => {
    const s = setup();
    s.client.createTraining.mockImplementation(async () => {
      expect(s.link().state.attempted).toBe(true);
      expect(s.link().state.expected).not.toBeNull();
      return { body: { id: 101 } } as never;
    });
    s.client.getTraining.mockRejectedValue(new Error('GET failed'));
    await s.process();
    expect(s.link().remoteTrainingId).toBe(101);
    expect(s.link().state.status).toBe('unknown');
    await s.process();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('stale CAS/crash claim prevents two engines posting the same link', async () => {
    const s = setup();
    const stale = s.link();
    const body = createProjection(s.plan.workouts[0]!, stale.state.marker);
    s.repository.cas(stale, {
      ...stale.state,
      attempted: true,
      expected: expectedProjection(body),
      status: 'unknown',
    });
    await s.engine().process(stale);
    expect(s.client.createTraining).not.toHaveBeenCalled();
    expect(s.repository.cas(stale, stale.state)).toBeNull();
    await s.process();
    expect(s.link().state.status).toBe('synced');
  });
  it('changed idle local plans update once while preserving the initial snapshot', async () => {
    const s = setup();
    await s.process();
    const changed = structuredClone(s.plan);
    changed.workouts[0]!.title = 'Changed';
    s.setPlans([changed]);
    await s.process();
    expect(s.link().state.status).toBe('synced');
    expect(s.link().state.published!.workout.title).toBe('Changed');
    expect(s.link().state.workout.title).toBe(s.plan.workouts[0]!.title);
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('remote edits are conflicts and ownership mismatch never caches foreign facts', async () => {
    const s = setup();
    await s.process();
    s.detail = { ...s.detail, name: 'External change' };
    await s.process();
    expect(s.link().state.reason).toBe('remote_changed');
    const actual = s.link().state.actual;
    s.detail = { ...s.detail, is_mine: false };
    await s.process();
    expect(s.link().state.actual).toEqual(actual);
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('started remote trains are read-only and actual range/zero/empty values stay verbatim despite ID churn', async () => {
    const s = setup();
    await s.process();
    s.detail.started = '2026-01-01T10:00:00Z';
    s.detail.progress = 'in_progress';
    const exercise = s.detail.protocols[0]!.workout_exercises[0]!;
    exercise.id = 998;
    const fact = exercise.metrics.find((m) => m.type === 'fact')!;
    fact.sets[0]!.id = 999;
    fact.sets[0]!.is_done = true;
    fact.sets[0]!.set_metrics = [
      {
        id: 21,
        type: 'range',
        measure: { id: 3, key: 'weight', name: 'Weight', short_name: 'kg' },
        metric_values: [
          { id: 22, value: '0' },
          { id: 23, value: '10–12' },
          { id: 24, value: '' },
        ],
      },
    ];
    await s.process();
    expect(s.link().state.reason).toBe('remote_started');
    expect(s.link().state.actual!.exercises[0]!.sets[0]).toEqual({
      order: 1,
      done: true,
      metrics: [
        {
          name: 'Weight',
          unit: 'kg',
          type: 'range',
          values: ['0', '10–12', ''],
        },
      ],
    });
    expect(s.link().state.actual!.exercises[0]!.occurrenceKey).not.toBeNull();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('later GET failure preserves previous facts and successful checkedAt', async () => {
    const s = setup();
    await s.process();
    const before = s.link().state;
    s.client.getTraining.mockRejectedValue(new Error('Failure'));
    await s.process();
    expect(s.link().state.actual).toEqual(before.actual);
    expect(s.link().state.checkedAt).toBe(before.checkedAt);
    expect(s.link().state.status).toBe('error');
  });
  it('missing metric capabilities refuse projection before creating', async () => {
    const s = setup();
    s.catalog.metrics = s.catalog.metrics.filter((m) => m.id !== 4);
    await s.process();
    expect(s.link().state.reason).toBe('unsupported');
    expect(s.client.createTraining).not.toHaveBeenCalled();
  });
  it('null weights omit weight metrics and do not invent a zero', async () => {
    const s = setup();
    const workout = structuredClone(s.plan.workouts[0]!);
    workout.exercises[0]!.sets[0]!.weightKg = null;
    const body = createProjection(workout, 'marker');
    expect(body.protocols[0]!.workout_exercises[0]!.exercise_metrics).toEqual([
      4,
    ]);
    expect(
      body.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.set_metrics,
    ).toHaveLength(1);
    expect(remoteProjection(remote(body))).toBe(expectedProjection(body));
  });
  it('manual plans remain local and mixed plans report unsupported', async () => {
    const s = setup();
    const manual = structuredClone(s.plan);
    manual.id = 'manual';
    delete manual.workouts[0]!.exercises[0]!.transformMate;
    s.repository.ensure('owner', manual);
    expect(s.repository.list('owner')).toHaveLength(1);
    const mixed = structuredClone(s.plan);
    mixed.id = 'mixed';
    mixed.workouts[0]!.exercises.push(manual.workouts[0]!.exercises[0]!);
    s.repository.ensure('owner', mixed);
    const link = s.repository.list('owner').find((l) => l.planId === 'mixed')!;
    await s.engine().process(link);
    expect(
      s.repository.list('owner').find((l) => l.planId === 'mixed')!.state
        .reason,
    ).toBe('unsupported');
    expect(s.client.createTraining).not.toHaveBeenCalled();
  });
  it('orphan links keep facts and never create, while linked orphans refresh reads', async () => {
    const s = setup();
    s.setPlans([]);
    await s.process();
    expect(s.client.createTraining).not.toHaveBeenCalled();
    s.setPlans([s.plan]);
    await s.process();
    s.setPlans([]);
    await s.process();
    expect(s.client.getTraining).toHaveBeenCalledTimes(2);
    expect(s.link().state.actual).not.toBeNull();
  });
  it('revocation during catalog read prevents POST and caching writes', async () => {
    const s = setup();
    let revoked = false;
    s.client.getExercise.mockImplementation(async () => {
      revoked = true;
      return {
        body: transformMateExerciseDetailSchema.parse(s.catalog),
      } as never;
    });
    s.access.mockImplementation(async () => {
      if (revoked) throw new Error('Access denied');
    });
    await expect(s.process()).rejects.toThrow('Access denied');
    expect(s.client.createTraining).not.toHaveBeenCalled();
    expect(s.link().revision).toBe(1);
  });
  it('revocation during detail GET preserves prior cache without granting a new display', async () => {
    const s = setup();
    await s.process();
    const before = s.link();
    let revoked = false;
    s.client.getTraining.mockImplementation(async () => {
      revoked = true;
      return { body: s.detail } as never;
    });
    s.access.mockImplementation(async () => {
      if (revoked) throw new Error('Access denied');
    });
    await expect(s.process()).rejects.toThrow('Access denied');
    expect(s.link()).toEqual(before);
  });
  it('plan permission is required before the durable claim or POST', async () => {
    const s = setup();
    s.access.mockImplementation(async (p) => {
      if (p === 'workouts:plan') throw new Error('Denied plan');
    });
    await expect(s.process()).rejects.toThrow('Denied plan');
    expect(s.link().state.attempted).toBe(false);
    expect(s.client.createTraining).not.toHaveBeenCalled();
  });
  it('owner scopes prevent querying or CAS mutation of another owner link', () => {
    const s = setup();
    expect(s.repository.list('other')).toEqual([]);
    expect(
      s.repository.cas({ ...s.link(), ownerId: 'other' }, s.link().state),
    ).toBeNull();
    expect(s.link().revision).toBe(1);
  });

  it('rejects successful POST with invalid/mismatched GET without trusting the result', async () => {
    const s = setup();
    s.client.getTraining.mockImplementation(
      async () => ({ body: { ...s.detail, id: 102 } }) as never,
    );
    await s.process();
    expect(s.link().remoteTrainingId).toBe(101);
    expect(s.link().state.status).toBe('conflict');
    expect(s.link().state.actual).toBeNull();
  });
  it('requires complete initial fact placeholders and never patches an incomplete remote projection', async () => {
    const s = setup();
    s.client.getTraining.mockImplementation(async () => {
      const detail = structuredClone(s.detail);
      detail.protocols[0]!.workout_exercises[0]!.metrics.find(
        (m) => m.type === 'fact',
      )!.sets = [];
      return { body: detail } as never;
    });
    await s.process();
    expect(s.link().state.reason).toBe('remote_changed');
    expect(s.link().state.baseline).toBeNull();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('preserves explicit fact order when set arrays and their volatile IDs are reordered', async () => {
    const s = setup();
    await s.process();
    const fact = s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
      (m) => m.type === 'fact',
    )!;
    const first = { ...fact.sets[0]!, id: 999, order: 1, is_done: true };
    const second = { ...fact.sets[0]!, id: 1, order: 2, is_done: false };
    fact.sets = [second, first];
    await s.process();
    expect(
      s
        .link()
        .state.actual!.exercises[0]!.sets.map((set) => [set.order, set.done]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
  });
  it('plan deletion during catalog await prevents creating an orphan upstream', async () => {
    const s = setup();
    s.client.getExercise.mockImplementation(async () => {
      s.setPlans([]);
      return {
        body: transformMateExerciseDetailSchema.parse(s.catalog),
      } as never;
    });
    await s.process();
    expect(s.client.createTraining).not.toHaveBeenCalled();
    expect(s.link().state.attempted).toBe(false);
  });
  it('does not import historical best/last values into current facts', async () => {
    const s = setup();
    const e = s.detail.protocols[0]!.workout_exercises[0]!;
    e.best_result = {
      set_metrics: [
        {
          type: 'straight',
          measure: { id: 3 },
          metric_values: [{ id: 1, value: '999' }],
        },
      ],
    };
    await s.process();
    expect(s.link().state.actual!.exercises[0]!.sets[0]!.metrics).toEqual([]);
  });

  it('rejects extra catalog metrics even when weight/reps are present', async () => {
    const s = setup();
    s.catalog.metrics.push({
      ...s.catalog.metrics[0]!,
      id: 5,
      key: 'duration',
    });
    await s.process();
    expect(s.link().state.reason).toBe('unsupported');
    expect(s.client.createTraining).not.toHaveBeenCalled();
  });
  it('rejects duplicate fact order without replacing previous facts', async () => {
    const s = setup();
    await s.process();
    const previous = s.link().state;
    const fact = s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
      (m) => m.type === 'fact',
    )!;
    fact.sets.push({ ...fact.sets[0]!, id: 999 });
    await s.process();
    expect(s.link().state.status).toBe('error');
    expect(s.link().state.actual).toEqual(previous.actual);
    expect(s.link().state.checkedAt).toBe(previous.checkedAt);
  });
  it('bounds persisted marker, projections and optimistic revisions before writes', () => {
    const s = setup();
    const link = s.link();
    expect(() =>
      s.repository.cas({ ...link, revision: 0 }, link.state),
    ).toThrow();
    expect(() =>
      s.repository.cas(
        { ...link, revision: Number.MAX_SAFE_INTEGER },
        link.state,
      ),
    ).toThrow();
    expect(() =>
      s.repository.cas(link, { ...link.state, marker: 'wrong' }),
    ).toThrow();
    expect(() =>
      s.repository.cas(link, {
        ...link.state,
        expected: 'a'.repeat(2 * 1024 * 1024 + 1),
      }),
    ).toThrow();
    expect(s.link().revision).toBe(1);
  });

  it('publishes the latest edited pending snapshot once after configuration becomes available', async () => {
    const s = setup();
    const original = s.link();
    await s.engine(null).process(original);
    const latest = structuredClone(s.plan);
    latest.title = 'Latest plan';
    latest.workouts[0]!.title = 'Latest training';
    const first = latest.workouts[0]!.exercises[0]!;
    first.name = 'Latest exercise';
    first.comment = 'Latest comment';
    first.sets = [
      { reps: 11, weightKg: 14 },
      { reps: 6, weightKg: null },
    ];
    const second = structuredClone(first);
    second.name = 'Second exercise';
    second.comment = 'Second comment';
    second.transformMate!.occurrenceKey =
      '7b4df6d6-1c68-4565-95f0-0861bb71ce7f';
    second.sets = [{ reps: 3, weightKg: 0 }];
    latest.workouts[0]!.exercises = [second, first];
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    await s.engine(null).process(s.link());
    expect(s.link().state.workout).toEqual(latest.workouts[0]);
    expect(s.link().state.planTitle).toBe(latest.title);
    expect(s.link().state.marker).toBe(original.state.marker);
    await s.process();
    await s.process();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    const body = createTrainingInputSchema.parse(
      s.client.createTraining.mock.calls[0]![0],
    );
    expect(body).toEqual(
      createProjection(latest.workouts[0]!, original.state.marker),
    );
    expect(s.link().state.status).toBe('synced');
  });
  it('a concurrent plan edit fences an old preflight claim and only the latest plan posts', async () => {
    const s = setup();
    const stale = s.link();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.client.getExercise.mockImplementationOnce(async () => {
      entered();
      await gate;
      return {
        body: transformMateExerciseDetailSchema.parse(s.catalog),
      } as never;
    });
    const oldProcess = s.engine().process(stale);
    await started;
    const latest = structuredClone(s.plan);
    latest.workouts[0]!.title = 'Latest after preflight';
    latest.workouts[0]!.exercises[0]!.sets = [{ reps: 15, weightKg: 20 }];
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    release();
    await oldProcess;
    expect(s.client.createTraining).not.toHaveBeenCalled();
    expect(s.link().state.attempted).toBe(false);
    await s.process();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    expect(s.link().state.workout).toEqual(latest.workouts[0]);
    expect(s.link().state.status).toBe('synced');
  });
  it('concurrent engines cannot create old and new trainings after pending reconciliation', async () => {
    const s = setup();
    const stale = s.link();
    const latest = structuredClone(s.plan);
    latest.workouts[0]!.title = 'Latest';
    s.setPlans([latest]);
    await Promise.all([s.engine().process(stale), s.engine().process(stale)]);
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    expect(s.link().state.workout).toEqual(latest.workouts[0]);
    expect(s.link().state.status).toBe('synced');
  });
  it('unknown attempted snapshots stay immutable across edits without another POST', async () => {
    const s = setup();
    s.client.createTraining.mockRejectedValue(new Error('Timeout'));
    s.client.listTrainings.mockResolvedValue({ body: [] } as never);
    await s.process();
    const original = s.link();
    const latest = structuredClone(s.plan);
    latest.title = 'Edited plan';
    latest.workouts[0]!.title = 'Edited after ambiguous attempt';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    expect(s.link()).toEqual(original);
    await s.process();
    expect(s.link().state.workout).toEqual(original.state.workout);
    expect(s.link().state.planTitle).toBe(original.state.planTitle);
    expect(s.link().state.expected).toBe(original.state.expected);
    expect(s.link().state.status).toBe('unknown');
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('mixed pending plans can become supported before their first attempt', async () => {
    const s = setup();
    const mixed = structuredClone(s.plan);
    const manual = structuredClone(mixed.workouts[0]!.exercises[0]!);
    delete manual.transformMate;
    mixed.workouts[0]!.exercises.push(manual);
    s.setPlans([mixed]);
    s.repository.ensure('owner', mixed);
    expect(s.link().state.reason).toBe('unsupported');
    const latest = structuredClone(s.plan);
    latest.title = 'Supported';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    expect(s.link().state.status).toBe('pending');
    expect(s.link().state.reason).toBeNull();
    await s.process();
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    expect(s.link().state.status).toBe('synced');
  });
  it('engine reconciliation updates never-attempted snapshots before missing-client status', async () => {
    const s = setup();
    const latest = structuredClone(s.plan);
    latest.title = 'Latest';
    latest.workouts[0]!.title = 'Latest workout';
    s.setPlans([latest]);
    await s.engine(null).process(s.link());
    expect(s.link().state.planTitle).toBe('Latest');
    expect(s.link().state.workout.title).toBe('Latest workout');
    expect(s.link().state.reason).toBe('not_configured');
    expect(s.link().state.attempted).toBe(false);
  });

  it('updates idle date/title/comments/reps/weight once with immutable initial history', async () => {
    const s = setup();
    await s.process();
    const initial = s.link().state.workout;
    const latest = structuredClone(s.plan);
    const workout = latest.workouts[0]!;
    workout.title = 'Edited';
    workout.date = '2026-01-02';
    workout.exercises[0]!.comment = 'Edited comment';
    workout.exercises[0]!.sets = [{ reps: 10, weightKg: 0 }];
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    expect(s.link().state.updateAttempt!.phase).toBe('pending');
    await s.process();
    await s.process();
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
    expect(s.link().state.published!.workout).toEqual(workout);
    expect(s.link().state.workout).toEqual(initial);
    expect(s.link().state.updateAttempt!.phase).toBe('verified');
    expect(s.link().state.actual!.title).toBe('Edited');
  });
  it('supports exercise reorder/add/remove and aligned set add/remove without duplicate trainings', async () => {
    const s = setup();
    await s.process();
    const latest = structuredClone(s.plan);
    const first = latest.workouts[0]!.exercises[0]!;
    first.sets.push({ reps: 3, weightKg: null });
    const second = structuredClone(first);
    second.transformMate!.occurrenceKey =
      '7b4df6d6-1c68-4565-95f0-0861bb71ce7f';
    second.comment = 'Second';
    second.sets = [{ reps: 5, weightKg: 7 }];
    latest.workouts[0]!.exercises = [second, first];
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    await s.process();
    expect(s.link().state.status).toBe('synced');
    const firstBody = s.client.updateTrainingOnce.mock.calls[0]![1];
    expect(firstBody.protocols[0]!.workout_exercises[0]!.id).toBeUndefined();
    expect(firstBody.protocols[0]!.workout_exercises[1]!.id).toBe(401);
    expect(
      firstBody.protocols[0]!.workout_exercises[1]!.metrics.find(
        (m) => m.type === 'fact',
      )!.sets,
    ).toHaveLength(2);
    expect(
      s.link().state.actual!.exercises.map((e) => e.occurrenceKey),
    ).toEqual(
      latest.workouts[0]!.exercises.map((e) => e.transformMate!.occurrenceKey),
    );
    const removed = structuredClone(latest);
    removed.workouts[0]!.exercises = [removed.workouts[0]!.exercises[1]!];
    removed.workouts[0]!.exercises[0]!.sets.splice(1);
    s.setPlans([removed]);
    s.repository.ensure('owner', removed);
    await s.process();
    expect(s.link().state.status).toBe('synced');
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(2);
    const body = s.client.updateTrainingOnce.mock.calls[1]![1];
    expect(body.protocols[0]!.workout_exercises).toHaveLength(1);
    expect(
      body.protocols[0]!.workout_exercises[0]!.metrics.find(
        (m) => m.type === 'fact',
      )!.sets,
    ).toHaveLength(1);
  });
  it.each([true, false])(
    'update timeout committed=%s is durably reconciled without repeated PATCH',
    async (committed) => {
      const s = setup();
      await s.process();
      const latest = structuredClone(s.plan);
      latest.workouts[0]!.title = 'Desired';
      s.setPlans([latest]);
      s.repository.ensure('owner', latest);
      s.client.updateTrainingOnce.mockImplementation(async (_id, body) => {
        expect(s.link().state.updateAttempt!.phase).toBe('unknown');
        expect(
          s.link().state.updateAttempt!.expectedFingerprint,
        ).not.toBeNull();
        if (committed) s.detail = remote(body);
        throw new Error('Timeout');
      });
      await s.process();
      const snapshot = s.link().state.updateAttempt!;
      expect(snapshot.phase).toBe(committed ? 'verified' : 'unknown');
      const again = structuredClone(latest);
      again.workouts[0]!.title = 'Newer local';
      s.setPlans([again]);
      s.repository.ensure('owner', again);
      if (!committed) {
        expect(s.link().state.updateAttempt!.id).toBe(snapshot.id);
        await s.process();
        await s.process();
        expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
        expect(s.link().state.updateAttempt!.phase).toBe('unknown');
        expect(s.link().state.published!.workout.title).toBe(
          s.plan.workouts[0]!.title,
        );
      }
    },
  );
  it.each(['start', 'done', 'zero', 'range', 'empty', 'technique'] as const)(
    'rejects observed remote %s before idle PATCH',
    async (kind) => {
      const s = setup();
      await s.process();
      const latest = structuredClone(s.plan);
      latest.workouts[0]!.title = 'Desired';
      s.setPlans([latest]);
      s.repository.ensure('owner', latest);
      const fact = s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
        (m) => m.type === 'fact',
      )!;
      if (kind === 'start') {
        s.detail.started = '2026-01-01T10:00:00Z';
        s.detail.progress = 'in_progress';
      } else if (kind === 'done') fact.sets[0]!.is_done = true;
      else if (kind === 'technique') fact.sets[0]!.techniques = [{ id: 1 }];
      else
        fact.sets[0]!.set_metrics = [
          {
            id: 1,
            type: kind === 'range' ? 'range' : 'straight',
            measure: { id: 3, key: 'weight', name: 'Weight', short_name: 'kg' },
            metric_values: [
              {
                id: 2,
                value: kind === 'zero' ? '0' : kind === 'empty' ? '' : '10–12',
              },
            ],
          },
        ];
      await s.process();
      expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
      expect(s.link().state.status).toBe(
        kind === 'start' ? 'started' : 'conflict',
      );
      expect(s.link().state.reason).toBe(
        kind === 'start' ? 'remote_started' : 'remote_fact',
      );
      expect(s.link().state.updateAttempt!.phase).toBe('conflict');
      expect(s.link().state.actual).not.toBeNull();
    },
  );
  it('an external idle plan edit refuses PATCH and keeps the established baseline', async () => {
    const s = setup();
    await s.process();
    const baseline = s.link().state.baseline;
    const latest = structuredClone(s.plan);
    latest.workouts[0]!.title = 'Local';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    s.detail.name = 'External';
    await s.process();
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    expect(s.link().state.reason).toBe('remote_changed');
    expect(s.link().state.baseline).toBe(baseline);
  });
  it('pending mixed plans remain honestly local only and cannot PATCH partial exercises', async () => {
    const s = setup();
    await s.process();
    const latest = structuredClone(s.plan);
    delete latest.workouts[0]!.exercises[0]!.transformMate;
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    await s.process();
    expect(s.link().state.reason).toBe('unsupported');
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    expect(s.link().state.published!.workout).toEqual(s.plan.workouts[0]);
  });
  it('local update during preflight loses the stale CAS claim, then only latest intent can PATCH', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.title = 'First';
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    let entered!: () => void;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    s.client.getTraining.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { body: s.detail } as never;
    });
    const old = s.process();
    await started;
    const latest = structuredClone(desired);
    latest.workouts[0]!.title = 'Latest';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    release();
    await old;
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    await s.process();
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
    expect(s.link().state.published!.workout.title).toBe('Latest');
  });
  it('concurrent update processors can claim only one durable PATCH', async () => {
    const s = setup();
    await s.process();
    const latest = structuredClone(s.plan);
    latest.workouts[0]!.title = 'Desired';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    const stale = s.link();
    await Promise.all([s.engine().process(stale), s.engine().process(stale)]);
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
    expect(s.link().state.updateAttempt!.phase).toBe('verified');
  });
  it('connection replacement after durable claim denies the HTTP mutation', async () => {
    const s = setup();
    await s.process();
    const latest = structuredClone(s.plan);
    latest.workouts[0]!.title = 'Desired';
    s.setPlans([latest]);
    s.repository.ensure('owner', latest);
    const fence = async () => {
      if (s.link().state.updateAttempt?.phase === 'unknown')
        throw new Error('Connection changed');
    };
    await expect(s.processFenced(fence)).rejects.toThrow('Connection changed');
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    expect(s.link().state.updateAttempt!.phase).toBe('unknown');
  });

  it('structural builder preserves untouched fresh metadata and fresh fact IDs', async () => {
    const s = setup();
    await s.process();
    const e = s.detail.protocols[0]!.workout_exercises[0]!;
    e.target_indication = { id: 9, name: 'Synthetic target' };
    e.videoreport_required = true;
    e.warmup_metrics = { note: 'Synthetic warmup' };
    e.id = 998;
    const plan = e.metrics.find((m) => m.type === 'plan')!;
    plan.sets[0]!.techniques = [{ id: 7 }];
    plan.sets[0]!.id = 999;
    const fact = e.metrics.find((m) => m.type === 'fact')!;
    fact.id = 900;
    fact.sets[0]!.id = 901;
    const desired = structuredClone(s.plan.workouts[0]!);
    desired.exercises[0]!.comment = 'Changed';
    desired.exercises[0]!.sets[0]!.reps = 12;
    const { body, projection } = updateProjection(
      s.detail,
      s.plan.workouts[0]!,
      desired,
    );
    const updated = body.protocols[0]!.workout_exercises[0]!;
    expect(updated.id).toBe(998);
    expect(updated.target_indication).toBe(9);
    expect(updated.videoreport_required).toBe(true);
    expect(updated.metrics.find((m) => m.type === 'fact')!).toEqual({
      id: 900,
      type: 'fact',
      sets: [{ id: 901, is_done: false, techniques: [], set_metrics: [] }],
    });
    expect(
      updated.metrics.find((m) => m.type === 'plan')!.sets[0]!.techniques,
    ).toEqual([7]);
    expect(JSON.parse(projection).protocols[0].exercises[0]).toMatchObject({
      target: e.target_indication,
      video: true,
      warmup: e.warmup_metrics,
    });
  });
  it('catalog replacement removes the old empty occurrence and adds a validated new exercise', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.exercises[0]!.transformMate!.exerciseId = 502;
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    await s.process();
    expect(s.link().state.status).toBe('synced');
    const body = s.client.updateTrainingOnce.mock.calls[0]![1];
    expect(body.protocols[0]!.workout_exercises[0]!.id).toBeUndefined();
    expect(body.protocols[0]!.workout_exercises[0]!.exercise).toBe(502);
    expect(s.link().state.actual!.exercises[0]!.exerciseId).toBe(502);
    expect(s.client.createTraining).toHaveBeenCalledTimes(1);
  });
  it('retains the explicitly accepted race proof: an unobserved concurrent fact can be erased by whole PATCH', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.title = 'Desired';
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    let hadFact = false;
    s.client.updateTrainingOnce.mockImplementation(async (_id, body) => {
      const fact = s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
        (m) => m.type === 'fact',
      )!;
      fact.sets[0]!.is_done = true;
      fact.sets[0]!.set_metrics = [
        {
          id: 1,
          type: 'straight',
          measure: { id: 3, key: 'weight', name: 'Weight', short_name: 'kg' },
          metric_values: [{ id: 2, value: '15' }],
        },
      ];
      hadFact = true;
      s.detail = remote(body);
      return { body: { id: 101 } } as never;
    });
    await s.process();
    expect(hadFact).toBe(true);
    expect(s.link().state.updateAttempt!.phase).toBe('verified');
    expect(s.link().state.actual!.exercises[0]!.sets[0]!.metrics).toEqual([]);
    expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
  });

  it('reverting a pending local edit fences/cancels its old claim without PATCH', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.title = 'Pending';
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    const stale = s.link();
    s.setPlans([s.plan]);
    s.repository.ensure('owner', s.plan);
    expect(s.link().revision).toBeGreaterThan(stale.revision);
    expect(s.link().state.updateAttempt!.phase).toBe('conflict');
    await s.engine().process(stale);
    await s.process();
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    expect(s.link().state.status).toBe('synced');
  });
  it('local changes during token acquisition deny the already claimed PATCH before sending', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.title = 'Desired';
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    let sends = 0;
    s.client.updateTrainingOnce.mockImplementation(
      async (_id, body, beforeSend) => {
        s.setPlans([s.plan]);
        s.repository.ensure('owner', s.plan);
        await beforeSend?.();
        sends++;
        s.detail = remote(body);
        return { body: { id: 101 } } as never;
      },
    );
    await s.process();
    expect(sends).toBe(0);
    expect(s.link().state.updateAttempt!.phase).toBe('unknown');
    expect(s.link().state.published!.workout.title).toBe('Demo training');
  });

  it.each([false, true])(
    'fresh verification distinguishes idle/started fact data started=%s',
    async (started) => {
      const s = setup();
      await s.process();
      const fact = s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
        (m) => m.type === 'fact',
      )!;
      fact.sets[0]!.is_done = true;
      if (started) {
        s.detail.started = '2026-01-01T10:00:00Z';
        s.detail.progress = 'in_progress';
      }
      await s.process();
      expect(s.link().state.status).toBe(started ? 'started' : 'conflict');
      expect(s.link().state.reason).toBe(
        started ? 'remote_started' : 'remote_fact',
      );
      expect(s.link().state.actual!.exercises[0]!.sets[0]!.done).toBe(true);
      expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'verified unknown update distinguishes idle/started fact data started=%s',
    async (started) => {
      const s = setup();
      await s.process();
      const desired = structuredClone(s.plan);
      desired.workouts[0]!.title = 'Desired';
      s.setPlans([desired]);
      s.repository.ensure('owner', desired);
      s.client.updateTrainingOnce.mockImplementation(async (_id, body) => {
        s.detail = remote(body);
        s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
          (m) => m.type === 'fact',
        )!.sets[0]!.is_done = true;
        if (started) {
          s.detail.started = '2026-01-01T10:00:00Z';
          s.detail.progress = 'in_progress';
        }
        return { body: { id: 101 } } as never;
      });
      await s.process();
      expect(s.link().state.updateAttempt!.phase).toBe('verified');
      expect(s.link().state.status).toBe(started ? 'started' : 'conflict');
      expect(s.link().state.reason).toBe(
        started ? 'remote_started' : 'remote_fact',
      );
      expect(s.link().state.actual!.exercises[0]!.sets[0]!.done).toBe(true);
      expect(s.client.updateTrainingOnce).toHaveBeenCalledTimes(1);
    },
  );
  it('started preflight keeps lifecycle precedence when fact data also exists', async () => {
    const s = setup();
    await s.process();
    const desired = structuredClone(s.plan);
    desired.workouts[0]!.title = 'Desired';
    s.setPlans([desired]);
    s.repository.ensure('owner', desired);
    s.detail.started = '2026-01-01T10:00:00Z';
    s.detail.progress = 'in_progress';
    s.detail.protocols[0]!.workout_exercises[0]!.metrics.find(
      (m) => m.type === 'fact',
    )!.sets[0]!.is_done = true;
    await s.process();
    expect(s.link().state.status).toBe('started');
    expect(s.link().state.reason).toBe('remote_started');
    expect(s.link().state.actual!.exercises[0]!.sets[0]!.done).toBe(true);
    expect(s.client.updateTrainingOnce).not.toHaveBeenCalled();
  });
  it('serializes owner work while releasing a failed queue', async () => {
    const calls: number[] = [];
    await Promise.all([
      serializeOwner('queue', async () => {
        calls.push(1);
        await Promise.resolve();
        calls.push(2);
      }),
      serializeOwner('queue', async () => {
        calls.push(3);
      }),
    ]);
    expect(calls).toEqual([1, 2, 3]);
    await expect(
      serializeOwner('queue', async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await serializeOwner('queue', async () => {
      calls.push(4);
    });
    expect(calls.at(-1)).toBe(4);
  });
});
