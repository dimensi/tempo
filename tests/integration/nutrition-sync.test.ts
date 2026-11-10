import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { nutritionRepository } from '@/server/nutrition/repository';
import { syncNutritionPeriod } from '@/server/jobs/nutrition-sync';
import {
  createNutritionScheduler,
  stopNutritionScheduler,
} from '@/server/jobs/nutrition-scheduler';
import { register } from '@/instrumentation';
import * as databaseRuntime from '@/server/db';
import * as adapterRuntime from '@/server/yazio/adapter';
import * as tokenRuntime from '@/server/yazio/token-store';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import type { NutritionDayUpstream } from '@/server/yazio/adapter';

vi.mock('server-only', () => ({}));
vi.mock('@/server/transformmate/replica-worker', () => ({
  startTransformMateReplicaWorker: vi.fn(),
}));
vi.mock('@/server/workouts/videos', () => ({
  startWorkoutVideoWorker: vi.fn(),
}));
vi.mock('@/server/yazio/body-runtime', () => ({
  runBodySync: vi.fn(async () => {}),
}));
let database: ReturnType<typeof openDatabase>;
let repository: ReturnType<typeof nutritionRepository>;
const date = '2026-01-01';
const nutrients = {
  'energy.energy': 1,
  'nutrient.protein': 0.1,
  'nutrient.fat': 0.2,
  'nutrient.carb': 0.3,
};

function upstream(): NutritionDayUpstream {
  return {
    items: vi.fn(async () => ({
      products: [
        {
          id: 'entry',
          date: `${date} 12:00:00`,
          daytime: 'lunch' as const,
          product_id: 'product',
          amount: 10,
          serving: null,
          serving_quantity: null,
        },
      ],
      recipe_portions: [],
      simple_products: [],
    })),
    summary: vi.fn(async () => ({ meals: { lunch: { nutrients } } })),
    images: vi.fn(async () => ({})),
    product: vi.fn(async () => ({
      name: 'Synthetic product',
      base_unit: 'g',
      nutrients,
    })),
    recipe: vi.fn(async () => null),
  };
}

beforeEach(() => {
  database = openDatabase('file::memory:');
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
  repository = nutritionRepository(database);
});
afterEach(() => {
  stopNutritionScheduler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  database.sqlite.close();
});

it('persists a completed day once and keeps the last durable snapshot on an upstream failure', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const source = upstream();
  expect(
    (
      await syncNutritionPeriod(
        'owner',
        { from: date, to: date },
        source,
        repository,
      )
    ).state,
  ).toBe('completed');
  const previous = repository.day('owner', date)!;
  expect(previous.meals[1]?.totals.calories).toBe('10');

  vi.mocked(source.summary).mockRejectedValueOnce(
    new Error('Synthetic outage'),
  );
  await expect(
    syncNutritionPeriod(
      'owner',
      { from: date, to: date },
      source,
      repository,
      undefined,
      { force: true },
    ),
  ).resolves.toMatchObject({ state: 'failed', failedDates: [date] });
  expect(repository.day('owner', date)).toEqual(previous);

  let clock = Date.parse('2026-01-02T12:00:00Z');
  let failGoals = false;
  const foodGate = Promise.withResolvers<void>();
  const photoGate = Promise.withResolvers<void>();
  const photosStarted = Promise.withResolvers<void>();
  let holdReads = true;
  const goalRead = vi.fn(async (day: string) => {
    if (failGoals) throw new Error('Synthetic goal outage');
    return { date: day, calories: '2000', steps: 8000, weight: '72.5' };
  });
  const scheduler = () =>
    createNutritionScheduler({
      database,
      now: () => clock,
      configured: () => true,
      store: () => ({
        load: async () => ({
          access_token: 'synthetic',
          refresh_token: 'synthetic',
          expires_in: 3600,
          expires_at: clock + 3600000,
          token_type: 'Bearer',
        }),
        save: async () => {},
      }),
      source: async () => ({
        ...upstream(),
        goals: goalRead,
        images: async () =>
          holdReads
            ? { lunch: 'https://images.yazio-cdn.com/fixture.jpg' }
            : {},
        items: async (day) => {
          if (holdReads) await foodGate.promise;
          const value = await upstream().items(day);
          return {
            ...value,
            products: value.products.map((item) => ({
              ...item,
              date: `${day} 12:00:00`,
            })),
          };
        },
        healthSummary: async (day) => ({
          dailySteps: { source: 'yazio', date: day, steps: 5000 },
          unitContext: null,
        }),
        weight: async () => null,
      }),
      images: {
        fetch: async () => {
          photosStarted.resolve();
          await photoGate.promise;
          throw new Error('Synthetic photo outage');
        },
        store: async () => {
          throw new Error('Unexpected image write');
        },
      },
      repository,
    });
  scheduler().enable('owner', { initialFrom: date, timezone: 'UTC' });
  // A server tick can run without an open page, and shares the lease with the overview.
  const today = '2026-01-02';
  const previousPhotoId = `owner:${today}:lunch:yazio`;
  repository.addPhoto({
    id: previousPhotoId,
    ownerId: 'owner',
    date: today,
    daytime: 'lunch',
    source: 'yazio',
    sourceUrl: 'https://images.yazio-cdn.com/previous.jpg',
    observedAt: '2026-01-02T10:00:00Z',
    storageKey: 'synthetic',
    contentHash: 'synthetic',
    mime: 'image/jpeg',
  });
  const scheduled = scheduler().scheduled();
  try {
    await expect(scheduler().overview('owner', 'UTC')).resolves.toEqual({
      started: false,
    });
    await vi.waitFor(() => {
      expect(
        yazioHealthRepository(database.db).steps('owner', {
          from: today,
          to: today,
        })[0]?.steps,
      ).toBe(5000);
    });
    expect(repository.day('owner', today)).toBeNull();
    foodGate.resolve();
    await photosStarted.promise;
    expect(repository.day('owner', today)?.totals.calories).toBe('10');
    expect(scheduler().liveStatus('owner').activity).toMatchObject({
      food: [],
      steps: [],
      photos: [today, date],
    });
  } finally {
    holdReads = false;
    foodGate.resolve();
    photoGate.resolve();
    await scheduled;
  }
  expect(scheduler().liveStatus('owner').activity).toBeNull();
  expect(scheduler().liveStatus('owner').last.photoFailedDates).toEqual([
    today,
  ]);
  expect(repository.photo('owner', previousPhotoId)?.sourceUrl).toContain(
    '/previous.jpg',
  );
  expect(goalRead).toHaveBeenCalledTimes(2);
  expect(dailyGoalsRepository(database).day('owner', date)).toMatchObject({
    calories: '2000',
    steps: 8000,
    weight: '72.5',
  });
  await scheduler().overview('owner', 'UTC');
  expect(goalRead).toHaveBeenCalledTimes(2);
  clock += 3600001;
  failGoals = true;
  await scheduler().overview('owner', 'Pacific/Honolulu');
  expect(goalRead).toHaveBeenCalledTimes(4);
  expect(dailyGoalsRepository(database).day('owner', date).calories).toBe(
    '2000',
  );
  expect(dailyGoalsRepository(database).day('owner', date).weight).toBe('72.5');
  // Failed automatic reads are persisted attempts too, including a fresh scheduler.
  await scheduler().overview('owner', 'UTC');
  expect(goalRead).toHaveBeenCalledTimes(4);
  expect(
    database.db.select().from(nutritionSchedule).get()?.automaticAttemptAt,
  ).toBe(clock);
  clock += 3600001;
  // Failed goals in an otherwise successful manual import do not establish freshness.
  await scheduler().run(
    'owner',
    { from: date, to: '2026-01-02' },
    { mode: 'manual', timezone: 'UTC' },
  );
  const afterManualFailure = goalRead.mock.calls.length;
  await scheduler().overview('owner', 'UTC');
  expect(goalRead).toHaveBeenCalledTimes(afterManualFailure + 2);
  clock += 3600001;
  failGoals = false;
  await scheduler().run(
    'owner',
    { from: date, to: '2026-01-02' },
    { mode: 'manual', timezone: 'UTC' },
  );
  const afterManualSuccess = goalRead.mock.calls.length;
  await scheduler().overview('owner', 'UTC');
  expect(goalRead).toHaveBeenCalledTimes(afterManualSuccess);

  clock += 10 * 86400000;
  const beforeRepair = database.db.select().from(nutritionSchedule).get();
  await scheduler().recent('owner', 'Pacific/Honolulu');
  expect(
    goalRead.mock.calls.slice(afterManualSuccess).map(([day]) => day),
  ).toEqual([
    '2026-01-12',
    '2026-01-11',
    '2026-01-10',
    '2026-01-09',
    '2026-01-08',
    '2026-01-07',
    '2026-01-06',
  ]);
  expect(database.db.select().from(nutritionSchedule).get()).toMatchObject({
    initialFrom: date,
    timezone: 'UTC',
    automaticAttemptAt: beforeRepair?.automaticAttemptAt,
    recentSuccessDate: '2026-01-12',
  });
  await scheduler().scheduled();
  expect(goalRead).toHaveBeenCalledTimes(afterManualSuccess + 7);

  // A new history anchor limits server refresh to that date, without erasing history.
  clock += 3600001;
  await scheduler().run(
    'owner',
    { from: '2026-01-12', to: '2026-01-12' },
    {
      mode: 'manual',
      timezone: 'UTC',
    },
  );
  expect(repository.day('owner', date)).not.toBeNull();
  clock += 3600001;
  const beforeLimitedRun = goalRead.mock.calls.length;
  await scheduler().scheduled();
  expect(goalRead.mock.calls.slice(beforeLimitedRun)).toEqual([['2026-01-12']]);
  // Exercise the real Next.js registration and interval, not scheduled() directly.
  // Only outside workers, the DB handle and upstream/token IO are synthetic.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(clock);
  const getDatabase = vi
    .spyOn(databaseRuntime, 'getDatabase')
    .mockReturnValue(database);
  const privateMarker = 'private-owner-token-path-error-must-not-appear';
  const load = vi.fn(async () => ({
    access_token: privateMarker,
    refresh_token: privateMarker,
    expires_in: 3600,
    expires_at: clock + 3600000,
    token_type: 'Bearer',
  }));
  vi.spyOn(tokenRuntime, 'fileTokenStore').mockReturnValue({
    load,
    save: async () => {},
    disconnect: async () => {},
  });
  const runtimeSource = vi
    .spyOn(adapterRuntime, 'nutritionUpstream')
    .mockResolvedValue({
      ...upstream(),
      items: async () => ({
        products: [],
        recipe_portions: [],
        simple_products: [],
      }),
      goals: goalRead,
      healthSummary: async (day) => ({
        dailySteps: { source: 'yazio', date: day, steps: 5000 },
        unitContext: null,
      }),
      weight: async () => null,
    });
  const events = (name: string) =>
    [info, warn]
      .flatMap((spy) =>
        spy.mock.calls.map((call, index) => ({
          call,
          order: spy.mock.invocationCallOrder[index]!,
        })),
      )
      .sort((a, b) => a.order - b.order)
      .filter(({ call: [event] }) => event === `yazio_${name}`)
      .map(({ call: [, data] }) => JSON.parse(String(data)));
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NEXT_PHASE', 'phase-production-build');
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'true');
  vi.stubEnv('ENABLE_ANAMNESIS_WORKER', 'false');
  vi.stubEnv('BETTER_AUTH_SECRET', privateMarker);
  vi.stubEnv('BETTER_AUTH_URL', 'https://synthetic.example.test');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('YAZIO_TOKEN_FILE', `.data/private/${privateMarker}`);
  await register();
  expect(vi.getTimerCount()).toBe(0);
  vi.stubEnv('NEXT_PHASE', '');
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'false');
  await register();
  await register();
  expect(events('scheduler_disabled')).toEqual([
    expect.objectContaining({ reason: 'feature_flag_disabled' }),
  ]);
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'true');
  vi.stubEnv('YAZIO_TOKEN_FILE', '');
  await register();
  expect(vi.getTimerCount()).toBe(0);
  expect(events('scheduler_disabled').at(-1)).toMatchObject({
    reason: 'connection_not_configured',
  });
  vi.stubEnv('YAZIO_TOKEN_FILE', `.data/private/${privateMarker}`);
  await register();
  await register();
  expect(vi.getTimerCount()).toBe(1);
  expect(events('scheduler_started')).toHaveLength(1);
  expect(runtimeSource).not.toHaveBeenCalled();

  scheduler().disable('owner');
  await vi.advanceTimersByTimeAsync(90000);
  expect(
    events('scheduler_skipped').filter(
      (event) => event.reason === 'no_enabled_owners',
    ),
  ).toHaveLength(1);
  // A synchronous factory/DB failure must be caught by the actual timer, sanitized,
  // and must not stop the next tick. Identical failures do not flood runtime logs.
  getDatabase.mockImplementationOnce(() => {
    throw new Error(privateMarker);
  });
  await vi.advanceTimersByTimeAsync(30000);
  getDatabase.mockImplementationOnce(() => {
    throw new Error(privateMarker);
  });
  await vi.advanceTimersByTimeAsync(30000);
  expect(
    events('scheduler_failed').filter((event) => event.stage === 'tick'),
  ).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30000);
  getDatabase.mockImplementationOnce(() => {
    throw new Error(privateMarker);
  });
  await vi.advanceTimersByTimeAsync(30000);
  expect(
    events('scheduler_failed').filter((event) => event.stage === 'tick'),
  ).toHaveLength(2);

  scheduler().enable('owner', { initialFrom: '2026-01-12', timezone: 'UTC' });
  load.mockRejectedValueOnce(new Error(privateMarker));
  await vi.advanceTimersByTimeAsync(30000);
  expect(events('sync_failed').at(-1)).toMatchObject({
    trigger: 'timer',
    code: 'SYNC_FAILED',
  });
  await vi.advanceTimersByTimeAsync(90000);
  expect(runtimeSource).not.toHaveBeenCalled();
  const cooldowns = events('scheduler_skipped').filter(
    (event) => event.trigger === 'timer' && event.reason === 'attempt_cooldown',
  );
  expect(cooldowns).toHaveLength(1);
  expect(cooldowns[0].nextEligibleAt).toBeTruthy();
  await vi.advanceTimersByTimeAsync(3600000);
  expect(runtimeSource).toHaveBeenCalledTimes(1);
  expect(events('sync_completed').at(-1)).toMatchObject({
    trigger: 'timer',
    outcome: 'success',
  });
  expect(
    events('sync_started').some((event) => event.trigger === 'overview'),
  ).toBe(true);
  expect(
    events('sync_completed').some(
      (event) => event.outcome === 'partial' && event.goalsFailures > 0,
    ),
  ).toBe(true);
  const allOutput = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
  expect(allOutput).not.toContain(privateMarker);
  expect(events('sync_started').at(-1)).not.toHaveProperty('ownerId');
  stopNutritionScheduler();
  expect(vi.getTimerCount()).toBe(0);
  const readCount = runtimeSource.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3600000);
  expect(runtimeSource).toHaveBeenCalledTimes(readCount);
});
