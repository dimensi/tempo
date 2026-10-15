import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { nutritionRepository } from '@/server/nutrition/repository';
import type { NutritionUpstream } from '@/server/yazio/adapter';
import type { YazioTokenStore } from '@/server/yazio/client';
import {
  createNutritionScheduler,
  type NutritionSchedulerDependencies,
  nutritionLocalDate,
  stopNutritionScheduler,
  startNutritionScheduler,
} from '@/server/jobs/nutrition-scheduler';
import { readServerEnv } from '@/server/env';
import { nutritionScheduleInputSchema } from '@/contracts/nutrition-schedule';
import { syncProgress } from '@/server/yazio/sync-progress';

vi.mock('server-only', () => ({}));
let database: ReturnType<typeof openDatabase>;
let directory: string;
const token = {
  token_type: 'Bearer',
  access_token: 'synthetic',
  refresh_token: 'synthetic',
  expires_in: 100,
  expires_at: 9999999999,
};
const emptySummary = {
  meals: Object.fromEntries(
    ['breakfast', 'lunch', 'dinner', 'snack'].map((kind) => [
      kind,
      { nutrients: {} },
    ]),
  ),
} as Awaited<ReturnType<NutritionUpstream['summary']>>;
function source(): NutritionUpstream {
  return {
    items: vi.fn(async () => ({
      products: [],
      recipe_portions: [],
      simple_products: [],
    })),
    summary: vi.fn(async () => emptySummary),
    healthSummary: vi.fn(async (date) => ({
      dailySteps: { source: 'yazio' as const, date, steps: null },
      unitContext: null,
    })),
    weight: vi.fn(async () => null),
    images: vi.fn(async () => ({})),
    product: vi.fn(async () => null),
    recipe: vi.fn(async () => null),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(images?: NutritionSchedulerDependencies['images']) {
  const upstream = source();
  const store: YazioTokenStore = {
    load: vi.fn(async () => token),
    save: vi.fn(async () => {}),
    assertCurrent: vi.fn(async () => {}),
  };
  const repository = nutritionRepository(database);
  const deps = {
    healthRepository:
      undefined as NutritionSchedulerDependencies['healthRepository'],
    database,
    automaticEnabled: vi.fn(() => true),
    configured: vi.fn(() => true),
    store: vi.fn(() => store),
    source: vi.fn(async () => upstream),
    repository,
    images,
  };
  const service = createNutritionScheduler(deps);
  return { upstream, store, repository, deps, service };
}
const period = { from: '2026-10-11', to: '2026-10-11' };
const input = { timezone: 'Europe/Moscow', initialFrom: '2026-10-01' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T22:30:00Z'));
  directory = mkdtempSync(join(tmpdir(), 'nutrition-scheduler-'));
  database = openDatabase(`file:${join(directory, 'test.sqlite')}`);
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
afterEach(() => {
  stopNutritionScheduler();
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('durable owner schedule', () => {
  it.each(
    (['SYNC_FAILED', 'PHOTO_INCOMPLETE'] as const).flatMap((lastError) =>
      (['none', 'steps', 'weight', 'body'] as const).flatMap((pendingPart) =>
        [false, true].map((fails) => ({ lastError, pendingPart, fails })),
      ),
    ),
  )(
    'retains $lastError and retry deadline with only $pendingPart pending (fails=$fails)',
    async ({ lastError, pendingPart, fails }) => {
      const { deps, upstream } = setup();
      const bodySync = vi.fn<
        NonNullable<NutritionSchedulerDependencies['bodySync']>
      >(async () => {});
      if (fails) {
        vi.mocked(upstream.healthSummary).mockRejectedValue(
          new Error('synthetic'),
        );
        vi.mocked(upstream.weight).mockRejectedValue(new Error('synthetic'));
        bodySync.mockRejectedValue(new Error('synthetic'));
      }
      const service = createNutritionScheduler({ ...deps, bodySync });
      service.enable('owner', input);
      const previous = {
        lastError,
        lastSuccess: Date.now() - 3600000,
        attempt: 2,
        nextRunAt: Date.now() + 60000,
      };
      database.db
        .update(nutritionSchedule)
        .set(previous)
        .where(eq(nutritionSchedule.ownerId, 'owner'))
        .run();
      const history = { from: '2026-10-01', to: '2026-10-01' };
      syncProgress(database).set('owner', history.from, {
        food: true,
        photos: true,
        steps: true,
        weight: true,
        body: true,
        ...(pendingPart === 'none' ? {} : { [pendingPart]: false }),
      });
      const result = await service.run('owner', history, {
        mode: 'manual',
        timezone: 'UTC',
      });
      expect(result.skippedDates).toEqual([history.from]);
      expect(result.completedDates).toEqual([]);
      for (const method of ['items', 'summary', 'images'] as const)
        expect(upstream[method]).not.toHaveBeenCalled();
      expect(upstream.healthSummary).toHaveBeenCalledTimes(
        pendingPart === 'steps' || pendingPart === 'weight' ? 1 : 0,
      );
      expect(upstream.weight).toHaveBeenCalledTimes(
        pendingPart === 'weight' ? 1 : 0,
      );
      expect(bodySync.mock.calls[0]?.[1]).toEqual(
        pendingPart === 'body' ? [history.from] : [],
      );
      expect(
        database.db
          .select()
          .from(nutritionSchedule)
          .where(eq(nutritionSchedule.ownerId, 'owner'))
          .get(),
      ).toMatchObject({
        ...previous,
        leaseId: null,
        leaseExpiresAt: null,
      });
    },
  );

  it('invalidates every historical checkpoint on credentials/token replacement without deleting the diary', async () => {
    const { service, upstream, repository } = setup();
    const history = { from: '2026-10-01', to: '2026-10-01' };
    await service.run('owner', history, { mode: 'manual', timezone: 'UTC' });
    const progress = syncProgress(database);
    progress.set('owner', history.from, {
      food: true,
      photos: true,
      steps: true,
      weight: true,
      body: true,
    });
    const savedDay = repository.day('owner', history.from);
    service.disable('owner');
    service.enable('owner', input);
    expect(repository.day('owner', history.from)).toEqual(savedDay);
    expect(progress.get('owner', history.from)).toBeUndefined();
    expect(
      progress
        .plan('owner', [history.from], '2026-10-12', false)
        .get(history.from),
    ).toEqual({
      food: true,
      photos: true,
      steps: true,
      weight: true,
      body: true,
    });
    vi.clearAllMocks();
    const result = await service.run('owner', history, {
      mode: 'manual',
      timezone: 'UTC',
    });
    expect(result.completedDates).toEqual([history.from]);
    expect(result.skippedDates).toEqual([]);
    expect(upstream.items).toHaveBeenCalledWith(history.from);
    expect(upstream.summary).toHaveBeenCalledWith(history.from);
    expect(upstream.images).toHaveBeenCalledWith(history.from);
    expect(upstream.healthSummary).toHaveBeenCalledWith(history.from);
    expect(upstream.weight).toHaveBeenCalledWith(history.from, null);
    // Token replacement while already connected follows the same enable path.
    service.enable('owner', input);
    expect(progress.get('owner', history.from)).toBeUndefined();
  });

  function withBody(deps: NutritionSchedulerDependencies) {
    const bodySync = vi.fn(
      async (
        ownerId: string,
        dates: string[],
        _epoch: number,
        assertCurrent: () => void,
      ) => {
        for (const date of dates) {
          assertCurrent();
          syncProgress(deps.database).set(ownerId, date, { body: true });
        }
      },
    );
    return {
      service: createNutritionScheduler({ ...deps, bodySync }),
      bodySync,
    };
  }
  it('persists empty historical days across reopening and makes no upstream reads for ready history', async () => {
    const { deps, upstream, repository } = setup();
    const { service } = withBody(deps);
    const history = { from: '2026-10-01', to: '2026-10-12' };
    await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    const old = repository.day('owner', history.from);
    const reopened = openDatabase(`file:${join(directory, 'test.sqlite')}`);
    try {
      const { service: restarted, bodySync } = withBody({
        ...deps,
        database: reopened,
        repository: nutritionRepository(reopened),
      });
      vi.clearAllMocks();
      await vi.advanceTimersByTimeAsync(14400000 - 1);
      await restarted.tick();
      expect(upstream.items).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await restarted.tick();
      for (const method of [
        'items',
        'summary',
        'images',
        'healthSummary',
        'weight',
      ] as const)
        expect(
          vi.mocked(upstream[method]).mock.calls.map(([date]) => date),
        ).toEqual(['2026-10-11', '2026-10-12']);
      expect(bodySync.mock.calls[0]![1]).toEqual(['2026-10-11', '2026-10-12']);
      expect(repository.day('owner', history.from)).toEqual(old);
      vi.clearAllMocks();
      const result = await restarted.run(
        'owner',
        { from: '2026-10-01', to: '2026-10-02' },
        { mode: 'manual', timezone: input.timezone },
      );
      expect(result).toMatchObject({
        state: 'completed',
        completedDates: [],
        skippedDates: ['2026-10-01', '2026-10-02'],
      });
      for (const method of [
        'items',
        'summary',
        'images',
        'healthSummary',
        'weight',
      ] as const)
        expect(upstream[method]).not.toHaveBeenCalled();
      expect(bodySync.mock.calls[0]![1]).toEqual([]);
      await restarted.run(
        'owner',
        { from: history.from, to: history.from },
        { mode: 'day-refresh', timezone: input.timezone },
      );
      expect(upstream.items).toHaveBeenCalledWith(history.from);
      expect(upstream.images).toHaveBeenCalledWith(history.from);
    } finally {
      reopened.sqlite.close();
    }
  });
  it('repairs historical photos without rereading food or downloading a successful unchanged slot', async () => {
    const images = {
      fetch: vi.fn(async (url: string) => {
        if (url.endsWith('dinner.jpg'))
          throw new Error('synthetic unavailable');
        return { bytes: Buffer.from([255, 216, 255, 0]), mime: 'image/jpeg' };
      }),
      store: vi.fn(async () => ({
        storageKey: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
      })),
    };
    const { deps, upstream, repository } = setup(images);
    const { service, bodySync } = withBody(deps);
    const date = '2026-10-01';
    const history = { from: date, to: date };
    vi.mocked(upstream.images).mockResolvedValue({
      lunch: 'https://images.yazio-cdn.com/lunch.jpg',
      dinner: 'https://images.yazio-cdn.com/dinner.jpg',
    });
    await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    const old = repository.day('owner', date);
    expect(syncProgress(database).get('owner', date)).toMatchObject({
      food: true,
      photos: false,
      steps: true,
      weight: true,
      body: true,
    });
    vi.clearAllMocks();
    vi.mocked(upstream.images).mockRejectedValueOnce(
      new Error('synthetic metadata unavailable'),
    );
    const metadataFailure = await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(metadataFailure).toMatchObject({
      state: 'partial',
      failedDates: [],
      skippedDates: [date],
      photoFailedDates: [date],
    });
    expect(upstream.items).not.toHaveBeenCalled();
    expect(images.fetch).not.toHaveBeenCalled();
    expect(repository.day('owner', date)).toEqual(old);
    expect(syncProgress(database).get('owner', date)).toMatchObject({
      food: true,
      photos: false,
    });
    vi.clearAllMocks();
    images.fetch.mockResolvedValue({
      bytes: Buffer.from([255, 216, 255, 0]),
      mime: 'image/jpeg',
    });
    const repaired = await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(repaired).toMatchObject({
      state: 'completed',
      completedDates: [],
      skippedDates: [date],
      photoFailedDates: [],
    });
    expect(upstream.items).not.toHaveBeenCalled();
    expect(upstream.summary).not.toHaveBeenCalled();
    expect(upstream.healthSummary).not.toHaveBeenCalled();
    expect(upstream.weight).not.toHaveBeenCalled();
    expect(bodySync.mock.calls[0]![1]).toEqual([]);
    expect(images.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://images.yazio-cdn.com/dinner.jpg',
    );
    expect(repository.day('owner', date)).toEqual(old);
    expect(syncProgress(database).get('owner', date)!.photos).toBe(true);
  });
  it('persists new historical food despite failed photo metadata and never rereads it during repair', async () => {
    const { deps, upstream, repository } = setup();
    const { service } = withBody(deps);
    const date = '2026-10-01';
    const history = { from: date, to: date };
    vi.mocked(upstream.items).mockResolvedValue({
      products: [],
      recipe_portions: [],
      simple_products: [
        {
          id: 'food',
          date: date + ' 12:00:00',
          daytime: 'lunch',
          name: 'Synthetic food',
          nutrients: { 'energy.energy': 10 },
          is_ai_generated: false,
        },
      ],
    });
    vi.mocked(upstream.images).mockRejectedValueOnce(
      new Error('Synthetic unavailable metadata'),
    );
    expect(
      await service.run('owner', history, {
        mode: 'manual',
        timezone: input.timezone,
      }),
    ).toMatchObject({
      state: 'partial',
      completedDates: [date],
      failedDates: [],
      photoFailedDates: [date],
    });
    expect(
      repository.day('owner', date)!.meals.flatMap((meal) => meal.entries),
    ).toHaveLength(1);
    expect(syncProgress(database).get('owner', date)).toMatchObject({
      food: true,
      photos: false,
    });
    vi.clearAllMocks();
    expect(
      await service.run('owner', history, {
        mode: 'manual',
        timezone: input.timezone,
      }),
    ).toMatchObject({
      state: 'completed',
      skippedDates: [date],
      completedDates: [],
      photoFailedDates: [],
    });
    expect(upstream.items).not.toHaveBeenCalled();
    expect(upstream.summary).not.toHaveBeenCalled();
    expect(upstream.images).toHaveBeenCalledExactlyOnceWith(date);
    expect(syncProgress(database).get('owner', date)).toMatchObject({
      food: true,
      photos: true,
    });
  });
  it('retries failed historical steps independently of completed food, weight and body', async () => {
    const { deps, upstream } = setup();
    const { service, bodySync } = withBody(deps);
    const history = { from: '2026-10-01', to: '2026-10-01' };
    vi.mocked(upstream.healthSummary).mockRejectedValueOnce(
      new Error('synthetic unavailable steps'),
    );
    await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(syncProgress(database).get('owner', history.from)).toMatchObject({
      food: true,
      photos: true,
      steps: false,
      weight: true,
      body: true,
    });
    vi.clearAllMocks();
    await service.run('owner', history, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(upstream.healthSummary).toHaveBeenCalledExactlyOnceWith(
      history.from,
    );
    expect(upstream.weight).not.toHaveBeenCalled();
    expect(upstream.items).not.toHaveBeenCalled();
    expect(upstream.images).not.toHaveBeenCalled();
    expect(bodySync.mock.calls[0]![1]).toEqual([]);
    expect(syncProgress(database).get('owner', history.from)!.steps).toBe(true);
  });
  it('refreshes exactly the selected day with a durable lease without changing history, timezone or enablement', async () => {
    const { service, deps, upstream } = setup();
    service.enable('owner', input);
    const delayed = deferred<Awaited<ReturnType<NutritionUpstream['items']>>>();
    vi.mocked(upstream.items).mockImplementationOnce(() => delayed.promise);
    const running = service.run('owner', period, {
      mode: 'day-refresh',
      timezone: 'America/New_York',
    });
    await vi.waitFor(() =>
      expect(upstream.items).toHaveBeenCalledWith(period.from),
    );
    await expect(
      createNutritionScheduler(deps).run('owner', period, {
        mode: 'day-refresh',
      }),
    ).rejects.toThrow('Sync already running');
    expect(service.status('owner')).toMatchObject({
      initialFrom: input.initialFrom,
      timezone: input.timezone,
      enabled: true,
      running: true,
    });
    delayed.resolve({ products: [], recipe_portions: [], simple_products: [] });
    expect(await running).toMatchObject({
      state: 'completed',
      completedDates: [period.from],
      skippedDates: [],
    });
    expect(upstream.items).toHaveBeenCalledTimes(1);
    expect(service.status('owner')).toMatchObject({
      initialFrom: input.initialFrom,
      timezone: input.timezone,
      enabled: true,
      running: false,
    });
    service.disable('owner');
    await service.run('owner', period, {
      mode: 'day-refresh',
      timezone: 'UTC',
    });
    expect(service.status('owner')).toMatchObject({
      initialFrom: input.initialFrom,
      timezone: input.timezone,
      enabled: false,
    });
  });
  it('does not auto-enable or set history for a day-refresh-first legacy connection', async () => {
    const { service } = setup();
    await service.run('owner', period, {
      mode: 'day-refresh',
      timezone: 'Europe/Moscow',
    });
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      initialFrom: null,
      timezone: 'UTC',
    });
  });
  it('persists the latest explicit manual start after narrowing history and never overwrites it automatic', async () => {
    const { service, deps, upstream } = setup();
    await service.run(
      'owner',
      { from: '2026-09-01', to: '2026-09-01' },
      { mode: 'manual', timezone: input.timezone },
    );
    await service.run(
      'owner',
      { from: '2026-10-12', to: '2026-10-12' },
      { mode: 'manual', timezone: input.timezone },
    );
    const reloaded = createNutritionScheduler(deps);
    expect(reloaded.status('owner').initialFrom).toBe('2026-10-12');
    vi.mocked(upstream.items).mockClear();
    await vi.advanceTimersByTimeAsync(14400000);
    await reloaded.tick();
    expect(vi.mocked(upstream.items).mock.calls.map(([date]) => date)).toEqual([
      '2026-10-12',
    ]);
    expect(reloaded.status('owner').initialFrom).toBe('2026-10-12');
  });
  it('records successful food updates separately from photo warnings with four-hour retries', async () => {
    const images = {
      fetch: vi.fn(async () => ({
        bytes: Buffer.from([255, 216, 255, 0]),
        mime: 'image/jpeg',
      })),
      store: vi.fn(async () => ({
        storageKey: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
      })),
    };
    images.fetch.mockRejectedValue(
      new Error('RAW PHOTO FAILURE MUST NOT LEAK'),
    );
    const { service, upstream, repository } = setup(images);
    vi.mocked(upstream.items).mockImplementation(async (date) => ({
      products: [],
      recipe_portions: [],
      simple_products: [
        {
          id: `food:${date}`,
          date: `${date} 12:00:00`,
          daytime: 'lunch',
          name: 'Synthetic food',
          nutrients: { 'energy.energy': 10 },
          is_ai_generated: false,
        },
      ],
    }));
    vi.mocked(upstream.images).mockResolvedValue({
      lunch: 'https://images.yazio-cdn.com/synthetic.jpg',
    });
    service.enable('owner', {
      timezone: input.timezone,
      initialFrom: '2026-10-12',
    });
    await vi.advanceTimersByTimeAsync(14400000);
    for (const [attempt, delay] of [
      [1, 14400000],
      [2, 14400000],
      [3, 14400000],
      [3, 14400000],
    ] as const) {
      const now = Date.now();
      await service.tick();
      expect(repository.status('owner')).toMatchObject({
        state: 'partial',
        completedDates: ['2026-10-12'],
        skippedDates: [],
        failedDates: [],
        photoFailedDates: ['2026-10-12'],
      });
      expect(
        repository.day('owner', '2026-10-12')!.meals[1]!.entries,
      ).toHaveLength(1);
      expect(service.status('owner')).toMatchObject({
        attempt,
        lastError: 'PHOTO_INCOMPLETE',
        lastSuccess: new Date(now).toISOString(),
        nextRunAt: new Date(now + delay).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(delay);
    }
    images.fetch.mockResolvedValue({
      bytes: Buffer.from([255, 216, 255, 0]),
      mime: 'image/jpeg',
    });
    await service.tick();
    expect(repository.status('owner')).toMatchObject({
      state: 'completed',
      failedDates: [],
      photoFailedDates: [],
    });
    expect(service.status('owner')).toMatchObject({
      attempt: 0,
      lastError: null,
      lastSuccess: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + 14400000).toISOString(),
    });
  });
  it('prioritizes food failure over photo warning and retains the previous successful food timestamp', async () => {
    const images = {
      fetch: vi.fn(async () => {
        throw new Error('Synthetic photo failure');
      }),
      store: vi.fn(async () => ({
        storageKey: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
      })),
    };
    const { service, upstream } = setup(images);
    vi.mocked(upstream.items).mockImplementation(async (date) => ({
      products: [],
      recipe_portions: [],
      simple_products: [
        {
          id: `food:${date}`,
          date: `${date} 12:00:00`,
          daytime: 'lunch',
          name: 'Synthetic food',
          nutrients: { 'energy.energy': 10 },
          is_ai_generated: false,
        },
      ],
    }));
    vi.mocked(upstream.images).mockResolvedValue({
      lunch: 'https://images.yazio-cdn.com/synthetic.jpg',
    });
    await service.run('owner', period, { mode: 'manual' });
    const previous = service.status('owner').lastSuccess;
    expect(previous).toBe(new Date().toISOString());
    await vi.advanceTimersByTimeAsync(1000);
    vi.mocked(upstream.items).mockImplementation(async (date) => {
      if (date === '2026-10-12') throw new Error('Synthetic food failure');
      return {
        products: [],
        recipe_portions: [],
        simple_products: [
          {
            id: `food:${date}`,
            date: `${date} 12:00:00`,
            daytime: 'lunch',
            name: 'Synthetic food',
            nutrients: { 'energy.energy': 10 },
            is_ai_generated: false,
          },
        ],
      };
    });
    const result = await service.run(
      'owner',
      { from: '2026-10-11', to: '2026-10-12' },
      { mode: 'manual' },
    );
    expect(result).toMatchObject({
      state: 'partial',
      failedDates: ['2026-10-12'],
      photoFailedDates: ['2026-10-11'],
    });
    expect(service.status('owner')).toMatchObject({
      lastError: 'SYNC_FAILED',
      lastSuccess: previous,
    });
  });
  it('rejects photo fallback after disconnect without recording food success or a late media warning', async () => {
    const pending = deferred<{ bytes: Buffer; mime: string }>();
    const images = {
      fetch: vi.fn(async () => pending.promise),
      store: vi.fn(async () => ({
        storageKey: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
      })),
    };
    const { service, upstream, repository } = setup(images);
    vi.mocked(upstream.items).mockResolvedValue({
      products: [],
      recipe_portions: [],
      simple_products: [
        {
          id: 'food',
          date: '2026-10-11 12:00:00',
          daytime: 'lunch',
          name: 'Synthetic food',
          nutrients: { 'energy.energy': 10 },
          is_ai_generated: false,
        },
      ],
    });
    vi.mocked(upstream.images).mockResolvedValue({
      lunch: 'https://images.yazio-cdn.com/synthetic.jpg',
    });
    const replace = vi.spyOn(repository, 'replaceDay');
    const running = service.run('owner', period, { mode: 'manual' });
    const rejected = expect(running).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(images.fetch).toHaveBeenCalledOnce();
    service.disable('owner');
    pending.reject(new Error('Synthetic interrupted image transfer'));
    await rejected;
    expect(replace).not.toHaveBeenCalled();
    expect(images.store).not.toHaveBeenCalled();
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      lastSuccess: null,
      lastError: null,
      nextRunAt: null,
    });
  });
  it.each([
    ['2026-10-12', ['2026-10-12']],
    ['2026-10-10', ['2026-10-10', '2026-10-11', '2026-10-12']],
    [
      '2026-10-01',
      [
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
        '2026-10-12',
      ],
    ],
  ])(
    'clips automatic history at persisted initialFrom %s',
    async (initialFrom, expected) => {
      const { service, upstream } = setup();
      service.enable('owner', { timezone: 'Europe/Moscow', initialFrom });
      await vi.advanceTimersByTimeAsync(14400000);
      await service.tick();
      expect(
        vi.mocked(upstream.items).mock.calls.map(([date]) => date),
      ).toEqual(expected);
    },
  );
  it('keeps the end date rolling with local today after the initial bound', async () => {
    const { service, upstream } = setup();
    service.enable('owner', {
      timezone: 'Europe/Moscow',
      initialFrom: '2026-10-12',
    });
    await vi.advanceTimersByTimeAsync(14400000);
    await service.tick();
    expect(vi.mocked(upstream.items).mock.calls.map(([date]) => date)).toEqual([
      '2026-10-12',
    ]);
    vi.mocked(upstream.items).mockClear();
    await vi.advanceTimersByTimeAsync(86400000);
    await service.tick();
    expect(vi.mocked(upstream.items).mock.calls.map(([date]) => date)).toEqual([
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(service.status('owner').initialFrom).toBe('2026-10-12');
  });
  it('adopts a connected manual-first legacy owner before the first poll and runs automatic afterwards', async () => {
    const { service, upstream } = setup();
    expect(database.db.select().from(nutritionSchedule).all()).toEqual([]);
    await service.run('owner', period, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(service.status('owner')).toMatchObject({
      enabled: true,
      timezone: input.timezone,
      initialFrom: period.from,
      nextRunAt: new Date(Date.now() + 14400000).toISOString(),
    });
    vi.mocked(upstream.items).mockClear();
    await service.tick();
    expect(upstream.items).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14400000);
    await service.tick();
    expect(vi.mocked(upstream.items).mock.calls.map(([date]) => date)).toEqual([
      '2026-10-11',
      '2026-10-12',
    ]);
  });
  it('never re-enables an explicitly disabled row during a valid manual sync', async () => {
    const { service } = setup();
    service.disable('owner');
    await service.run('owner', period, {
      mode: 'manual',
      timezone: input.timezone,
    });
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
  });
  it('does not auto-enable a newly inserted manual row when disconnect occurs during token load', async () => {
    const { service, store, deps } = setup();
    const pending = deferred<typeof token | null>();
    vi.mocked(store.load).mockReturnValue(pending.promise);
    const running = service.run('owner', period, { mode: 'manual' });
    const rejected = expect(running).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await vi.advanceTimersByTimeAsync(0);
    service.disable('owner');
    pending.resolve(token);
    await rejected;
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    expect(deps.source).not.toHaveBeenCalled();
  });
  it('leaves four hours for initial manual loading after connect instead of racing the browser', async () => {
    const { service, deps } = setup();
    service.enable('owner', input);
    expect(service.status('owner').nextRunAt).toBe(
      new Date(Date.now() + 14400000).toISOString(),
    );
    await service.tick();
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.source).not.toHaveBeenCalled();
    expect((await service.run('owner', period, { mode: 'manual' })).state).toBe(
      'completed',
    );
  });
  it('reclaims an expired lease after restart and fences the old generation from writes or release', async () => {
    const { service, deps, upstream, repository } = setup();
    service.enable('owner', input);
    const pending = deferred<Awaited<ReturnType<NutritionUpstream['items']>>>();
    vi.mocked(upstream.items).mockReturnValue(pending.promise);
    const replaced = vi.spyOn(repository, 'replaceDay');
    const running = service.run('owner', period, { mode: 'manual' });
    const rejected = expect(running).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await vi.advanceTimersByTimeAsync(0);
    // Model a stopped process without running its heartbeat, then reopen the
    // same WAL database as the replacement process. Keep its old promise only
    // to verify late results cannot corrupt the new lease/status/snapshot.
    vi.setSystemTime(Date.now() + 14400001);
    const reopened = openDatabase(`file:${join(directory, 'test.sqlite')}`);
    try {
      const newSource = source();
      vi.resetModules();
      const { createNutritionScheduler: restartedFactory } =
        await import('@/server/jobs/nutrition-scheduler');
      const restarted = restartedFactory({
        ...deps,
        database: reopened,
        repository: nutritionRepository(reopened),
        source: async () => newSource,
      });
      await restarted.tick();
      expect(
        vi.mocked(newSource.items).mock.calls.map(([date]) => date),
      ).toEqual(['2026-10-11', '2026-10-12']);
      const completed = restarted.status('owner');
      expect(completed).toMatchObject({
        running: false,
        lastError: null,
        lastSuccess: new Date().toISOString(),
      });
      pending.resolve({
        products: [],
        recipe_portions: [],
        simple_products: [],
      });
      await rejected;
      expect(replaced).not.toHaveBeenCalled();
      expect(restarted.status('owner')).toEqual(completed);
      expect(nutritionRepository(reopened).status('owner').state).toBe(
        'completed',
      );
      await restarted.tick();
      expect(
        vi.mocked(newSource.items).mock.calls.map(([date]) => date),
      ).toEqual(['2026-10-11', '2026-10-12']);
    } finally {
      pending.resolve({
        products: [],
        recipe_portions: [],
        simple_products: [],
      });
      await running.catch(() => {});
      reopened.sqlite.close();
    }
  });
  it('will not renew an expired lease or commit after losing it', async () => {
    const { service, upstream, repository } = setup();
    const pending = deferred<Awaited<ReturnType<NutritionUpstream['items']>>>();
    vi.mocked(upstream.items).mockReturnValue(pending.promise);
    const replace = vi.spyOn(repository, 'replaceDay');
    const running = service.run('owner', period, { mode: 'manual' });
    const rejected = expect(running).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await vi.advanceTimersByTimeAsync(0);
    const expired = Date.now() - 1;
    database.db
      .update(nutritionSchedule)
      .set({ leaseExpiresAt: expired })
      .run();
    await vi.advanceTimersByTimeAsync(20000);
    expect(
      database.db.select().from(nutritionSchedule).get()!.leaseExpiresAt,
    ).toBe(expired);
    pending.resolve({ products: [], recipe_portions: [], simple_products: [] });
    await rejected;
    expect(replace).not.toHaveBeenCalled();
    expect(service.status('owner').lastError).toBe('LEASE_LOST');
    expect(repository.status('owner')).toMatchObject({
      state: 'failed',
      failedDates: [period.from],
      photoFailedDates: [],
    });
  });
  it('uses local today and yesterday every four hours and preserves manual history across ticks', async () => {
    const { service, upstream } = setup();
    service.enable('owner', input);
    await service.run(
      'owner',
      { from: '2026-09-01', to: '2026-10-11' },
      { mode: 'manual', timezone: input.timezone },
    );
    expect(service.status('owner').initialFrom).toBe('2026-09-01');
    vi.mocked(upstream.items).mockClear();
    await vi.advanceTimersByTimeAsync(14400000);
    await service.tick();
    expect(vi.mocked(upstream.items).mock.calls.map(([date]) => date)).toEqual([
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(service.status('owner').initialFrom).toBe('2026-09-01');
    await service.tick();
    expect(upstream.items).toHaveBeenCalledTimes(2);
  });
  it('never constructs upstream without config, encrypted token, enabled schedule or owner', async () => {
    const { service, deps, store } = setup();
    deps.configured.mockReturnValue(false);
    await service.tick();
    expect(deps.store).not.toHaveBeenCalled();
    await expect(
      service.run('owner', period, { mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(deps.store).not.toHaveBeenCalled();
    deps.configured.mockReturnValue(true);
    vi.mocked(store.load).mockResolvedValue(null);
    service.enable('owner', input);
    await service.tick();
    expect(deps.source).not.toHaveBeenCalled();
    service.disable('owner');
    vi.mocked(store.load).mockClear();
    await service.tick();
    expect(store.load).not.toHaveBeenCalled();
    await expect(
      service.run('trainer', period, { mode: 'manual' }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(() => service.enable('trainer', input)).toThrow();
    deps.automaticEnabled.mockReturnValue(false);
    service.enable('owner', input);
    await service.tick();
    expect(store.load).not.toHaveBeenCalled();
    database.db.delete(user).where(eq(user.id, 'owner')).run();
    deps.automaticEnabled.mockReturnValue(true);
    await service.tick();
    expect(deps.source).not.toHaveBeenCalled();
  });
  it('holds the shared manual/automatic lease before source construction and through heartbeat', async () => {
    const { service, deps, upstream } = setup();
    const pending = deferred<Awaited<ReturnType<NutritionUpstream['items']>>>();
    vi.mocked(upstream.items).mockReturnValue(pending.promise);
    deps.source.mockImplementation(async () => {
      expect(
        database.db.select().from(nutritionSchedule).get()?.leaseId,
      ).toBeTruthy();
      return upstream;
    });
    service.enable('owner', input);
    const running = service.run('owner', period, { mode: 'manual' });
    await vi.advanceTimersByTimeAsync(0);
    await service.tick();
    await expect(
      createNutritionScheduler(deps).run('owner', period, { mode: 'manual' }),
    ).rejects.toThrow('Sync already running');
    await vi.advanceTimersByTimeAsync(130000);
    expect(
      database.db.select().from(nutritionSchedule).get()!.leaseExpiresAt,
    ).toBeGreaterThan(Date.now());
    expect(deps.source).toHaveBeenCalledTimes(1);
    pending.resolve({ products: [], recipe_portions: [], simple_products: [] });
    expect((await running).state).toBe('completed');
    expect(service.status('owner').running).toBe(false);
  });
  it('does not free the lease on an early rejected sibling while another read is pending', async () => {
    const { service, upstream } = setup();
    const pending =
      deferred<Awaited<ReturnType<NutritionUpstream['images']>>>();
    vi.mocked(upstream.images).mockReturnValue(pending.promise);
    vi.mocked(upstream.items).mockRejectedValue(
      new Error('SECRET RAW UPSTREAM'),
    );
    const running = service.run('owner', period, { mode: 'manual' });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.status('owner').running).toBe(true);
    await expect(
      service.run('owner', period, { mode: 'manual' }),
    ).rejects.toThrow('Sync already running');
    pending.resolve({});
    expect((await running).state).toBe('failed');
    expect(service.status('owner').lastError).toBe('SYNC_FAILED');
  });
  it('fences old results and completion across disconnect/reconnect without dropping the current lease', async () => {
    const { service, upstream, repository } = setup();
    const pending = deferred<Awaited<ReturnType<NutritionUpstream['items']>>>();
    vi.mocked(upstream.items).mockReturnValue(pending.promise);
    const replace = vi.spyOn(repository, 'replaceDay');
    service.enable('owner', input);
    const running = service.run('owner', period, { mode: 'manual' });
    const rejected = expect(running).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await vi.advanceTimersByTimeAsync(0);
    const lease = database.db.select().from(nutritionSchedule).get()!.leaseId;
    service.disable('owner');
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    service.enable('owner', { timezone: 'UTC', initialFrom: '2026-10-05' });
    expect(database.db.select().from(nutritionSchedule).get()!.leaseId).toBe(
      lease,
    );
    await expect(
      service.run('owner', period, { mode: 'manual' }),
    ).rejects.toThrow('Sync already running');
    const expected = service.status('owner');
    pending.resolve({ products: [], recipe_portions: [], simple_products: [] });
    await rejected;
    expect(replace).not.toHaveBeenCalled();
    expect(service.status('owner')).toEqual({ ...expected, running: false });
    expect(database.db.select().from(nutritionSchedule).get()!.epoch).toBe(3);
  });
  it('uses four-hour retries for failed and partial results and resets after success', async () => {
    const { service, upstream } = setup();
    service.enable('owner', input);
    await vi.advanceTimersByTimeAsync(14400000);
    vi.mocked(upstream.items).mockRejectedValue(
      new Error('TOKEN PASSWORD RAW ERROR'),
    );
    for (const [attempt, delay] of [
      [1, 14400000],
      [2, 14400000],
      [3, 14400000],
      [3, 14400000],
    ] as const) {
      const current = Date.now();
      await service.tick();
      expect(service.status('owner')).toMatchObject({
        attempt,
        lastError: 'SYNC_FAILED',
        nextRunAt: new Date(current + delay).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(delay);
    }
    vi.mocked(upstream.items).mockImplementation(async (date) => {
      if (date.endsWith('12')) throw new Error('raw');
      return { products: [], recipe_portions: [], simple_products: [] };
    });
    await service.tick();
    expect(service.status('owner').lastError).toBe('SYNC_FAILED');
    await vi.advanceTimersByTimeAsync(14400000);
    vi.mocked(upstream.items).mockResolvedValue({
      products: [],
      recipe_portions: [],
      simple_products: [],
    });
    await service.tick();
    expect(service.status('owner')).toMatchObject({
      attempt: 0,
      lastError: null,
      lastSuccess: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + 14400000).toISOString(),
    });
  });
  it('adopts only a legacy connected owner using UTC and never mutates status GET or re-enables disconnect', async () => {
    const { service, upstream, store } = setup();
    expect(service.status('owner').enabled).toBe(false);
    expect(database.db.select().from(nutritionSchedule).all()).toEqual([]);
    await service.tick();
    expect(store.load).toHaveBeenCalled();
    expect(service.status('owner')).toMatchObject({
      enabled: true,
      timezone: 'UTC',
      initialFrom: null,
    });
    expect(upstream.items).toHaveBeenCalledTimes(2);
    service.disable('owner');
    vi.mocked(store.load).mockClear();
    await vi.advanceTimersByTimeAsync(7200000);
    await service.tick();
    expect(store.load).not.toHaveBeenCalled();
    expect(service.status('owner').enabled).toBe(false);
  });
  it('does not adopt encrypted null or late token-load results after disconnect', async () => {
    const { service, store, deps } = setup();
    const pending = deferred<typeof token | null>();
    vi.mocked(store.load).mockReturnValue(pending.promise);
    const ticking = service.tick();
    await vi.advanceTimersByTimeAsync(0);
    service.disable('owner');
    pending.resolve(token);
    await ticking;
    expect(service.status('owner').enabled).toBe(false);
    expect(deps.source).not.toHaveBeenCalled();
    database.db.delete(nutritionSchedule).run();
    vi.mocked(store.load).mockResolvedValue(null);
    await service.tick();
    expect(service.status('owner')).toMatchObject({
      enabled: false,
      lastError: 'NOT_CONFIGURED',
    });
    expect(deps.source).not.toHaveBeenCalled();
  });
});

it('validates IANA/local midnight/DST and strict feature env with disabled defaults', () => {
  expect(
    nutritionLocalDate(Date.parse('2026-10-11T22:30:00Z'), 'Europe/Moscow'),
  ).toBe('2026-10-12');
  expect(
    nutritionLocalDate(Date.parse('2026-03-08T07:30:00Z'), 'America/New_York'),
  ).toBe('2026-03-08');
  expect(() =>
    nutritionScheduleInputSchema.parse({ ...input, timezone: 'Food/Guess' }),
  ).toThrow();
  expect(readServerEnv({ NODE_ENV: 'test' }).ENABLE_NUTRITION_SCHEDULER).toBe(
    'false',
  );
  expect(() =>
    readServerEnv({ NODE_ENV: 'test', ENABLE_NUTRITION_SCHEDULER: 'yes' }),
  ).toThrow();
  const { service } = setup();
  expect(() =>
    service.enable('owner', { ...input, initialFrom: '2026-10-13' }),
  ).toThrow();
});
it('never boots timers for dev/build/edge/disabled runtime or missing configuration', () => {
  for (const mode of [
    {
      NODE_ENV: 'development',
      NEXT_RUNTIME: 'nodejs',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    {
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      NEXT_PHASE: 'phase-production-build',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
    {
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'edge',
      ENABLE_NUTRITION_SCHEDULER: 'true',
    },
  ]) {
    for (const [key, value] of Object.entries(mode)) vi.stubEnv(key, value);
    startNutritionScheduler();
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllEnvs();
  }
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('BETTER_AUTH_URL', 'https://example.test');
  vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-test-only-secret-1234567890');
  startNutritionScheduler();
  expect(vi.getTimerCount()).toBe(0);
  vi.stubEnv('ENABLE_NUTRITION_SCHEDULER', 'true');
  startNutritionScheduler();
  expect(vi.getTimerCount()).toBe(0);
});

it('imports nullable steps and deduplicated raw last weights independently of food', async () => {
  const { service, upstream, repository } = setup();
  vi.mocked(upstream.healthSummary).mockImplementation(async (date) => ({
    dailySteps: {
      source: 'yazio',
      date,
      steps: date === period.from ? 0 : null,
    },
    unitContext: 'kg',
  }));
  vi.mocked(upstream.weight).mockImplementation(async (_date, unitContext) => ({
    source: 'yazio',
    externalId: '123e4567-e89b-42d3-a456-426614174000',
    providerDate: '2026-10-11T09:00:00Z',
    measuredDate: null,
    rawValue: '80',
    unit: null,
    unitContext,
    upstreamSource: 'synthetic',
    gateway: null,
  }));
  const result = await service.run(
    'owner',
    { from: period.from, to: '2026-10-12' },
    { mode: 'manual' },
  );
  expect(result.health).toEqual({
    completedStepsDates: [period.from, '2026-10-12'],
    failedStepsDates: [],
    completedWeightDates: [period.from, '2026-10-12'],
    failedWeightDates: [],
    error: null,
  });
  expect(
    database.sqlite
      .prepare('SELECT steps FROM yazio_daily_steps ORDER BY date')
      .all(),
  ).toEqual([{ steps: 0 }, { steps: null }]);
  expect(
    database.sqlite
      .prepare(
        'SELECT provider_date, measured_date, raw_value, unit, unit_context FROM yazio_weight_entries',
      )
      .all(),
  ).toEqual([
    {
      provider_date: '2026-10-11T09:00:00Z',
      measured_date: null,
      raw_value: '80',
      unit: null,
      unit_context: 'kg',
    },
  ]);
  expect(repository.status('owner').state).toBe('completed');
});
it('health read failures preserve successful food status, success timestamp and schedule', async () => {
  const { service, upstream, repository } = setup();
  vi.mocked(upstream.healthSummary).mockRejectedValue(
    new Error('PRIVATE HEALTH ERROR'),
  );
  vi.mocked(upstream.weight).mockRejectedValue(
    new Error('PRIVATE HEALTH ERROR'),
  );
  const result = await service.run('owner', period, { mode: 'manual' });
  expect(result.health).toMatchObject({
    failedStepsDates: [period.from],
    failedWeightDates: [period.from],
    error: 'HEALTH_IMPORT_FAILED',
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(repository.status('owner').state).toBe('completed');
  expect(service.status('owner')).toMatchObject({
    lastSuccess: new Date().toISOString(),
    lastError: null,
    attempt: 0,
  });
});
it('fences health results across disconnect/reconnect while retaining completed food', async () => {
  const { service, upstream, repository, deps } = setup();
  const pending = deferred<Awaited<ReturnType<NutritionUpstream['weight']>>>();
  vi.mocked(upstream.weight).mockReturnValue(pending.promise);
  const upsert = vi.fn();
  deps.healthRepository = { upsert };
  const running = createNutritionScheduler(deps).run('owner', period, {
    mode: 'manual',
  });
  const rejected = expect(running).rejects.toMatchObject({
    code: 'LEASE_LOST',
  });
  await vi.advanceTimersByTimeAsync(0);
  const foodSuccess = service.status('owner').lastSuccess;
  expect(repository.status('owner').state).toBe('completed');
  service.disable('owner');
  service.enable('owner', input);
  pending.resolve(null);
  await rejected;
  expect(upsert).not.toHaveBeenCalled();
  expect(service.status('owner').lastSuccess).toBe(foodSuccess);
  expect(repository.status('owner').state).toBe('completed');
});
it('health persistence failure rolls back its batch without changing food completion', async () => {
  const { service, upstream, repository } = setup();
  vi.mocked(upstream.healthSummary).mockImplementation(async (date) => ({
    dailySteps: { source: 'yazio', date, steps: 7 },
    unitContext: null,
  }));
  database.sqlite.exec(
    "CREATE TRIGGER synthetic_health_failure BEFORE INSERT ON yazio_daily_steps WHEN NEW.date = '2026-10-12' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  const result = await service.run(
    'owner',
    { from: period.from, to: '2026-10-12' },
    { mode: 'manual' },
  );
  expect(result.health).toMatchObject({
    completedStepsDates: [],
    failedStepsDates: [period.from, '2026-10-12'],
    error: 'HEALTH_IMPORT_FAILED',
  });
  expect(
    database.sqlite.prepare('SELECT * FROM yazio_daily_steps').all(),
  ).toEqual([]);
  expect(repository.status('owner').state).toBe('completed');
  expect(service.status('owner').lastError).toBeNull();
});

it('holds an expired health lease until its pending read drains and rejects late writes', async () => {
  const { upstream, deps, service } = setup();
  const pending = deferred<Awaited<ReturnType<NutritionUpstream['weight']>>>();
  vi.mocked(upstream.weight).mockReturnValue(pending.promise);
  const upsert = vi.fn();
  deps.healthRepository = { upsert };
  const running = createNutritionScheduler(deps).run('owner', period, {
    mode: 'manual',
  });
  const rejected = expect(running).rejects.toMatchObject({
    code: 'LEASE_LOST',
  });
  await vi.advanceTimersByTimeAsync(0);
  const lastSuccess = service.status('owner').lastSuccess;
  await vi.advanceTimersByTimeAsync(2 * 14400000);
  expect(
    database.db.select().from(nutritionSchedule).get()!.leaseId,
  ).toBeTruthy();
  await expect(
    service.run('owner', period, { mode: 'manual' }),
  ).rejects.toThrow('Sync already running');
  pending.resolve(null);
  await rejected;
  expect(upsert).not.toHaveBeenCalled();
  expect(service.status('owner').lastSuccess).toBe(lastSuccess);
  expect(
    database.db.select().from(nutritionSchedule).get()!.leaseId,
  ).toBeNull();
});

it('day refresh preserves history and food success when photo metadata and health weight fail independently', async () => {
  const { service, upstream, repository } = setup();
  service.enable('owner', input);
  vi.mocked(upstream.images).mockRejectedValue(
    new Error('Synthetic photo metadata failure'),
  );
  vi.mocked(upstream.healthSummary).mockImplementation(async (date) => ({
    dailySteps: { source: 'yazio', date, steps: 0 },
    unitContext: null,
  }));
  vi.mocked(upstream.weight).mockRejectedValue(
    new Error('Synthetic health failure'),
  );
  const result = await service.run('owner', period, { mode: 'day-refresh' });
  expect(result).toMatchObject({
    state: 'partial',
    completedDates: [period.from],
    skippedDates: [],
    failedDates: [],
    photoFailedDates: [period.from],
    health: {
      completedStepsDates: [period.from],
      failedStepsDates: [],
      completedWeightDates: [],
      failedWeightDates: [period.from],
      error: 'HEALTH_IMPORT_FAILED',
    },
  });
  expect(repository.status('owner')).toMatchObject({
    state: 'partial',
    failedDates: [],
    photoFailedDates: [period.from],
  });
  expect(service.status('owner')).toMatchObject({
    enabled: true,
    initialFrom: input.initialFrom,
    timezone: input.timezone,
    lastSuccess: new Date().toISOString(),
    lastError: 'PHOTO_INCOMPLETE',
    attempt: 1,
    running: false,
  });
  expect(upstream.items).toHaveBeenCalledExactlyOnceWith(period.from);
  expect(upstream.healthSummary).toHaveBeenCalledExactlyOnceWith(period.from);
  expect(upstream.weight).toHaveBeenCalledExactlyOnceWith(period.from, null);
  expect(
    database.sqlite.prepare('SELECT date, steps FROM yazio_daily_steps').all(),
  ).toEqual([{ date: period.from, steps: 0 }]);
});
