import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  publicationCapability,
  projectDetail,
  catalogItem,
} from '@/server/transformmate/catalog-projection';
import { canPlanExercise } from '@/server/transformmate/catalog-schema';
import { plannedWorkoutSchema } from '@/contracts/workouts';
import { createProjection } from '@/server/workouts/transformmate/mapping';
import { canProject } from '@/server/workouts/transformmate/mapping';
import {
  transformMateCatalogItemSchema,
  transformMateCatalogResultSchema,
} from '@/contracts/transformmate';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
const at = '2026-10-13T00:00:00.000Z';
it('shared publication gate agrees across catalog and publisher, independent of advertised advanced types or nullable weights', () => {
  const straight = {
    name: 'Straight',
    type: 'straight',
    key: '',
    friendly_techniques: [],
  };
  const base = exerciseDetailFixture();
  const metrics = [
    { ...base.metrics[0]!, set_metric_types: [straight] },
    { ...base.metrics[0]!, id: 4, key: 'reps', set_metric_types: [straight] },
  ];
  for (const candidate of [
    base.metrics,
    metrics,
    metrics.map((metric) => ({
      ...metric,
      set_metric_types: base.metrics[0]!.set_metric_types,
    })),
    [...metrics, { ...metrics[0]!, id: 8 }],
    [metrics[1]!, metrics[1]!],
    [metrics[0]!, { ...metrics[1]!, key: 'duration' }],
    [{ ...metrics[0]!, set_metric_types: [] }, metrics[1]!],
    [metrics[0]!, { ...metrics[1]!, set_metric_types: [] }],
  ]) {
    const detail = { ...base, metrics: candidate };
    const capability = publicationCapability(projectDetail(detail));
    expect(capability.state === 'supported').toBe(canPlanExercise(detail));
    expect(capability.state === 'supported').toBe(canProject(detail, false));
    expect(capability.state === 'supported').toBe(canProject(detail, true));
    if (capability.state === 'unsupported')
      expect(capability.reason).not.toBeNull();
  }
  expect(publicationCapability(null)).toEqual({
    state: 'unknown',
    reason: null,
  });
});
it('projects no URL/passthrough secrets and distinguishes unknown preview from absent', () => {
  const base = exerciseDetailFixture();
  const projected = projectDetail({
    ...base,
    secret: 'not-stored',
  } as typeof base);
  expect(projected).not.toHaveProperty('secret');
  expect(projected).not.toHaveProperty('video_link');
  const summary = { id: base.id, name: base.name, metrics: [] };
  const item = catalogItem(summary, at, projected, at, {
    ownerId: 'owner',
    accountScope: 'account',
    generation: 'epoch',
    locale: 'ru',
  });
  expect(item.preview).toMatchObject({ coverage: 'unknown', path: null });
  expect(item.preview.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(item)).not.toContain('https://');
  expect(
    catalogItem(summary, at, { ...projected, image: null }, at, {
      ownerId: 'owner',
      accountScope: 'account',
      generation: 'epoch',
      locale: 'ru',
    }).preview.coverage,
  ).toBe('absent');
  for (const path of [
    'https://evil.test/x',
    '/api/workouts/transformmate/exercises/501/preview?ownerId=owner&x=1',
    '/api/workouts/transformmate/exercises/0/preview?ownerId=owner',
    '/api/workouts/transformmate/exercises/501/arbitrary?ownerId=owner',
  ])
    expect(
      transformMateCatalogItemSchema.safeParse({
        ...item,
        preview: {
          coverage: 'available',
          path,
          revision: item.preview.revision,
        },
      }).success,
    ).toBe(false);
  expect(
    transformMateCatalogItemSchema.safeParse({
      ...item,
      preview: {
        coverage: 'available',
        revision: item.preview.revision,
        path: '/api/workouts/transformmate/exercises/501/preview?ownerId=owner%20one',
      },
    }).success,
  ).toBe(true);
});
it('requires one array public envelope with explicit cold/failed coverage', () => {
  const catalog = {
    fetchedAt: null,
    stale: true,
    coverage: 'unknown',
    refreshState: 'unavailable',
    total: null,
    hasMore: false,
    unknownMembershipCount: 0,
    filters: {
      query: '',
      commonMuscleGroup: null,
      muscleGroups: [],
      offset: 0,
      limit: 50,
    },
  };
  expect(
    transformMateCatalogResultSchema.parse({
      contractVersion: 1,
      source: 'user',
      data: [],
      catalog,
    }).catalog.coverage,
  ).toBe('unknown');
  expect(
    transformMateCatalogResultSchema.safeParse({
      contractVersion: 1,
      source: 'user',
      data: { items: [] },
      catalog,
    }).success,
  ).toBe(false);
});

it('publishes only explicit scalar straight values, omitting null weights despite advanced metadata', () => {
  const base = exerciseDetailFixture();
  const detail = {
    ...base,
    metrics: [
      { ...base.metrics[0]! },
      { ...base.metrics[0]!, id: 4, key: 'reps' },
    ],
  };
  expect(publicationCapability(projectDetail(detail))).toEqual({
    state: 'supported',
    reason: null,
  });
  const workout = plannedWorkoutSchema.parse({
    id: 'workout',
    date: '2026-10-13',
    title: 'Synthetic',
    exercises: [
      {
        name: 'Synthetic exercise',
        transformMate: {
          exerciseId: 501,
          occurrenceKey: '6eb373e0-9680-4ab7-b231-388fa7df4ac4',
        },
        sets: [
          { reps: 8, weightKg: null },
          { reps: 10, weightKg: 12.5 },
        ],
      },
    ],
  });
  const sets = createProjection(workout, 'synthetic').protocols[0]!
    .workout_exercises[0]!.metrics[0]!.sets;
  expect(sets[0]!.set_metrics).toEqual([
    { type: 'straight', measure: 4, metric_values: [{ value: '8' }] },
  ]);
  expect(sets[1]!.set_metrics).toEqual([
    { type: 'straight', measure: 3, metric_values: [{ value: '12.5' }] },
    { type: 'straight', measure: 4, metric_values: [{ value: '10' }] },
  ]);
});

it('changes opaque preview revision on provider scope, generation and image changes', () => {
  const detail = projectDetail(exerciseDetailFixture());
  const summary = { id: detail.id, name: detail.name, metrics: [] };
  const scope = {
    ownerId: 'owner',
    accountScope: 'private-account',
    generation: 'epoch',
    locale: 'ru' as const,
  };
  const original = catalogItem(summary, at, detail, at, scope).preview.revision;
  for (const changed of [
    { ...scope, generation: 'new-epoch' },
    { ...scope, accountScope: 'new-account' },
  ])
    expect(
      catalogItem(summary, at, detail, at, changed).preview.revision,
    ).not.toBe(original);
  expect(
    catalogItem(
      summary,
      at,
      { ...detail, image: 'https://transformmate.pht.space/new.png' },
      at,
      scope,
    ).preview.revision,
  ).not.toBe(original);
  expect(
    catalogItem(summary, at, detail, '2026-10-13T00:00:00Z', scope).preview
      .revision,
  ).toBe(original);
  expect(original).not.toContain(scope.accountScope);
});
