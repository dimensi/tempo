import 'server-only';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { and, eq, gt, lte, or, isNull, sql } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { readServerEnv } from '@/server/env';
import {
  nutritionScheduleInputSchema,
  nutritionTimezoneSchema,
  type NutritionScheduleInput,
  type NutritionScheduleStatus,
} from '@/contracts/nutrition-schedule';
import { periodSchema } from '@/contracts/nutrition-sync';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { fileTokenStore } from '@/server/yazio/token-store';
import {
  nutritionUpstream,
  type NutritionUpstream,
} from '@/server/yazio/adapter';
import type { YazioTokenStore } from '@/server/yazio/client';
import {
  nutritionRepository,
  type NutritionRepository,
} from '@/server/nutrition/repository';
import {
  NutritionSyncBusyError,
  periodDates,
  syncNutritionPeriod,
} from '@/server/jobs/nutrition-sync';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { syncYazioHealthPeriod } from './yazio-health-sync';
import { fetchCdnImage, storeImage } from '@/server/nutrition/images';

const HOUR = 3600000;
const LEASE_MS = 120000;
const HEARTBEAT_MS = 20000;
const MAX_RUN_MS = 2 * HOUR;
const RETRY_MS = [60000, 300000, 900000, HOUR];
type Database = ReturnType<typeof getDatabase>;
type Period = { from: string; to: string };
type RunOptions = { mode: 'manual' | 'scheduled'; timezone?: string };
type ErrorCode = NonNullable<NutritionScheduleStatus['lastError']>;
const activeRuns = new WeakMap<object, Set<string>>();

export class NutritionScheduleError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(
      code === 'NOT_CONFIGURED'
        ? 'Nutrition connection is unavailable'
        : 'Nutrition synchronization failed',
    );
  }
}

export function nutritionLocalDate(now: number, timezone: string) {
  return dateInTimezone(new Date(now), timezone);
}
const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString();

export interface NutritionSchedulerDependencies {
  database: Database;
  now?: () => number;
  automaticEnabled: () => boolean;
  configured: () => boolean;
  store: (ownerId: string) => YazioTokenStore;
  source?: (store: YazioTokenStore) => Promise<NutritionUpstream>;
  repository?: NutritionRepository;
  healthRepository?: Pick<ReturnType<typeof yazioHealthRepository>, 'upsert'>;
  images?: { fetch: typeof fetchCdnImage; store: typeof storeImage };
}

// No authentication substitute: request entry points must authorize before calling
// these internal services. The scheduler independently selects/checks the DB OWNER.
export function createNutritionScheduler(deps: NutritionSchedulerDependencies) {
  const { db } = deps.database;
  const now = deps.now ?? Date.now;
  const repository = deps.repository ?? nutritionRepository(deps.database);
  const active = activeRuns.get(deps.database.sqlite) ?? new Set<string>();
  activeRuns.set(deps.database.sqlite, active);
  const ownerScope = (ownerId: string) =>
    eq(nutritionSchedule.ownerId, ownerId);
  function requireOwner(ownerId: string) {
    if (
      !db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, ownerId), eq(user.role, 'OWNER')))
        .get()
    )
      throw new NutritionScheduleError('NOT_CONFIGURED');
  }
  const row = (ownerId: string) =>
    db.select().from(nutritionSchedule).where(ownerScope(ownerId)).get();
  function ensure(ownerId: string) {
    requireOwner(ownerId);
    db.insert(nutritionSchedule)
      .values({ ownerId })
      .onConflictDoNothing()
      .run();
    return row(ownerId)!;
  }
  function enable(ownerId: string, raw: NutritionScheduleInput) {
    const input = nutritionScheduleInputSchema.parse(raw);
    periodSchema.parse({
      from: input.initialFrom,
      to: nutritionLocalDate(now(), input.timezone),
    });
    ensure(ownerId);
    db.update(nutritionSchedule)
      .set({
        enabled: true,
        timezone: input.timezone,
        initialFrom: input.initialFrom,
        epoch: sql`${nutritionSchedule.epoch} + 1`,
        nextRunAt: now() + HOUR,
        attempt: 0,
        lastError: null,
      })
      .where(ownerScope(ownerId))
      .run();
    // Reconnection deliberately retains an existing lease until its owner drains.
  }
  function disable(ownerId: string) {
    ensure(ownerId);
    db.update(nutritionSchedule)
      .set({
        enabled: false,
        epoch: sql`${nutritionSchedule.epoch} + 1`,
        nextRunAt: null,
        attempt: 0,
        lastError: null,
      })
      .where(ownerScope(ownerId))
      .run();
  }
  function status(ownerId: string): NutritionScheduleStatus {
    requireOwner(ownerId);
    const current = row(ownerId);
    return {
      enabled: current?.enabled ?? false,
      schedulerActive: deps.automaticEnabled() && deps.configured(),
      timezone: current?.timezone ?? 'UTC',
      initialFrom: current?.initialFrom ?? null,
      lastSuccess: iso(current?.lastSuccess ?? null),
      lastError: current?.lastError ?? null,
      nextRunAt: iso(current?.nextRunAt ?? null),
      attempt: current?.attempt ?? 0,
      running: !!current?.leaseId && (current.leaseExpiresAt ?? 0) > now(),
    };
  }
  async function run(ownerId: string, raw: Period, options: RunOptions) {
    const period = periodSchema.parse(raw);
    if (options.timezone) nutritionTimezoneSchema.parse(options.timezone);
    requireOwner(ownerId);
    if (active.has(ownerId))
      throw new NutritionSyncBusyError('Sync already running');
    const leaseId = randomUUID();
    const started = now();
    const claim = db.transaction((tx) => {
      const created = !!tx
        .insert(nutritionSchedule)
        .values({ ownerId })
        .onConflictDoNothing()
        .returning()
        .get();
      const acquired = tx
        .update(nutritionSchedule)
        .set({
          leaseId,
          leaseStartedAt: started,
          leaseExpiresAt: started + LEASE_MS,
        })
        .where(
          and(
            ownerScope(ownerId),
            or(
              isNull(nutritionSchedule.leaseId),
              lte(nutritionSchedule.leaseExpiresAt, started),
            ),
            ...(options.mode === 'scheduled'
              ? [
                  eq(nutritionSchedule.enabled, true),
                  lte(nutritionSchedule.nextRunAt, started),
                ]
              : []),
          ),
        )
        .returning()
        .get();
      return { acquired, created };
    });
    const { acquired, created } = claim;
    if (!acquired) throw new NutritionSyncBusyError('Sync already running');
    active.add(ownerId);
    const pending = new Set<Promise<unknown>>();
    function track<T>(operation: () => Promise<T>) {
      const promise = Promise.resolve().then(operation);
      pending.add(promise);
      void promise.then(
        () => pending.delete(promise),
        () => pending.delete(promise),
      );
      return promise;
    }
    const fence = () =>
      and(
        ownerScope(ownerId),
        eq(nutritionSchedule.leaseId, leaseId),
        eq(nutritionSchedule.epoch, acquired.epoch),
        gt(nutritionSchedule.leaseExpiresAt, now()),
      );
    function assertCurrent() {
      requireOwner(ownerId);
      if (
        !db
          .select({ id: nutritionSchedule.ownerId })
          .from(nutritionSchedule)
          .where(fence())
          .get() ||
        now() >= started + MAX_RUN_MS
      )
        throw new NutritionScheduleError('LEASE_LOST');
    }
    function heartbeat() {
      // Renewal is fenced by epoch and UUID. Expired leases cannot resurrect.
      db.update(nutritionSchedule)
        .set({
          leaseExpiresAt: Math.min(now() + LEASE_MS, started + MAX_RUN_MS),
        })
        .where(
          and(
            ownerScope(ownerId),
            eq(nutritionSchedule.leaseId, leaseId),
            eq(nutritionSchedule.epoch, acquired.epoch),
            gt(nutritionSchedule.leaseExpiresAt, now()),
          ),
        )
        .run();
    }
    function complete(error: ErrorCode | null, foodSucceeded = false) {
      db.transaction(() => {
        const condition =
          error === 'LEASE_LOST'
            ? and(
                ownerScope(ownerId),
                eq(nutritionSchedule.leaseId, leaseId),
                eq(nutritionSchedule.epoch, acquired.epoch),
              )
            : fence();
        const current = db
          .select()
          .from(nutritionSchedule)
          .where(condition)
          .get();
        if (!current) return;
        // Only our own expired UUID/epoch can reconcile its stale running status.
        // A replacement lease or disconnect/reconnect epoch is never overwritten.
        if (error) {
          const status = repository.status(ownerId);
          if (status.state === 'running')
            repository.saveStatus(ownerId, {
              ...status,
              state: 'failed',
              finishedAt: new Date(now()).toISOString(),
              failedDates: periodDates(period).filter(
                (date) => !status.completedDates.includes(date),
              ),
            });
        }
        db.update(nutritionSchedule)
          .set({
            lastSuccess: foodSucceeded ? now() : current.lastSuccess,
            lastError: error,
            attempt: error ? Math.min(current.attempt + 1, 3) : 0,
            nextRunAt: current.enabled
              ? now() + (error ? RETRY_MS[current.attempt]! : HOUR)
              : null,
          })
          .where(condition)
          .run();
      });
    }
    let foodCompleted = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    try {
      if (options.mode === 'manual') {
        // Persist the last explicitly selected manual history boundary.
        db.update(nutritionSchedule)
          .set({
            initialFrom: period.from,
            ...(options.timezone ? { timezone: options.timezone } : {}),
          })
          .where(fence())
          .run();
      }
      heartbeatTimer = setInterval(() => {
        try {
          heartbeat();
        } catch {
          /* A failed heartbeat expires/fences the lease. */
        }
      }, HEARTBEAT_MS);
      heartbeatTimer.unref();
      if (!deps.configured())
        throw new NutritionScheduleError('NOT_CONFIGURED');
      const tokenStore = deps.store(ownerId);
      assertCurrent();
      if (!(await tokenStore.load()))
        throw new NutritionScheduleError('NOT_CONFIGURED');
      assertCurrent();
      if (created && options.mode === 'manual') {
        // A legacy connected owner may manually sync before the first timer
        // adoption. Only this freshly inserted row can be enabled here; an
        // explicit disable/reconnect increments epoch and defeats this fence.
        db.update(nutritionSchedule)
          .set({ enabled: true, nextRunAt: now() + HOUR })
          .where(fence())
          .run();
      }
      // Every token load/refresh save is fenced before SDK construction or auth.
      const guardedStore: YazioTokenStore = {
        async load() {
          assertCurrent();
          const token = await tokenStore.load();
          assertCurrent();
          return token;
        },
        async save(token) {
          assertCurrent();
          await tokenStore.save(token);
          assertCurrent();
        },
        async assertCurrent() {
          assertCurrent();
          await tokenStore.assertCurrent?.();
          assertCurrent();
        },
      };
      const source = await (deps.source ?? nutritionUpstream)(guardedStore);
      assertCurrent();
      // Check before and after upstream awaits, and synchronously before any DB
      // read/write: existing sync catches per-day failures, so stale status writes
      // must also be rejected rather than persisted by its catch path.
      const guardedSource = new Proxy(source, {
        get(target, key: keyof NutritionUpstream) {
          return async (...args: unknown[]) => {
            assertCurrent();
            const value = await track(() =>
              (target[key] as (...args: unknown[]) => Promise<unknown>).apply(
                target,
                args,
              ),
            );
            assertCurrent();
            return value;
          };
        },
      });
      const guardedRepository = new Proxy(repository, {
        get(target, key: keyof NutritionRepository) {
          return (...args: unknown[]) => {
            assertCurrent();
            return (target[key] as (...args: unknown[]) => unknown).apply(
              target,
              args,
            );
          };
        },
      });
      const result = await syncNutritionPeriod(
        ownerId,
        period,
        guardedSource,
        guardedRepository,
        {
          async fetch(url) {
            assertCurrent();
            const value = await track(() =>
              (deps.images?.fetch ?? fetchCdnImage)(url),
            );
            assertCurrent();
            return value;
          },
          async store(bytes, mime) {
            assertCurrent();
            const value = await track(() =>
              (deps.images?.store ?? storeImage)(bytes, mime),
            );
            assertCurrent();
            return value;
          },
        },
      );
      assertCurrent();
      const foodSucceeded = result.failedDates.length === 0;
      complete(
        !foodSucceeded
          ? 'SYNC_FAILED'
          : result.photoFailedDates.length
            ? 'PHOTO_INCOMPLETE'
            : null,
        foodSucceeded,
      );
      foodCompleted = true;
      const health = await syncYazioHealthPeriod(
        ownerId,
        period,
        guardedSource,
        deps.healthRepository ?? yazioHealthRepository(db),
        assertCurrent,
        new Date(now()).toISOString(),
      );
      assertCurrent();
      return { ...result, health };
    } catch (error) {
      const code =
        error instanceof NutritionScheduleError ? error.code : 'SYNC_FAILED';
      if (!foodCompleted) complete(code);
      throw new NutritionScheduleError(code);
    } finally {
      // A rejected sibling in Promise.all must not free the logical owner lease
      // while other source/image operations still run. SDK transport timeouts
      // remain bounded by its adapter; guarded token saves reject stale refreshes.
      await Promise.allSettled([...pending]);
      clearInterval(heartbeatTimer);
      try {
        db.update(nutritionSchedule)
          .set({ leaseId: null, leaseExpiresAt: null, leaseStartedAt: null })
          .where(
            and(ownerScope(ownerId), eq(nutritionSchedule.leaseId, leaseId)),
          )
          .run();
      } finally {
        active.delete(ownerId);
      }
    }
  }
  async function adopt(ownerId: string) {
    // Legacy connections predate hooks. Only an absent row is eligible; an
    // explicitly disabled schedule is never silently enabled by status or tick.
    requireOwner(ownerId);
    const leaseId = randomUUID();
    const inserted = db
      .insert(nutritionSchedule)
      .values({
        ownerId,
        leaseId,
        leaseStartedAt: now(),
        leaseExpiresAt: now() + LEASE_MS,
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!inserted) return;
    const fence = and(
      ownerScope(ownerId),
      eq(nutritionSchedule.epoch, 0),
      eq(nutritionSchedule.leaseId, leaseId),
    );
    try {
      const connected = !!(await deps.store(ownerId).load());
      requireOwner(ownerId);
      db.update(nutritionSchedule)
        .set({
          enabled: connected,
          timezone: 'UTC',
          epoch: 1,
          nextRunAt: connected ? now() : null,
          lastError: connected ? null : 'NOT_CONFIGURED',
        })
        .where(and(fence, gt(nutritionSchedule.leaseExpiresAt, now())))
        .run();
    } catch {
      db.update(nutritionSchedule)
        .set({ enabled: false, epoch: 1, lastError: 'NOT_CONFIGURED' })
        .where(fence)
        .run();
    } finally {
      db.update(nutritionSchedule)
        .set({ leaseId: null, leaseExpiresAt: null, leaseStartedAt: null })
        .where(and(ownerScope(ownerId), eq(nutritionSchedule.leaseId, leaseId)))
        .run();
    }
  }
  async function tick() {
    if (!deps.automaticEnabled() || !deps.configured()) return;
    const owner = db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'OWNER'))
      .get();
    if (!owner) return;
    if (!row(owner.id)) await adopt(owner.id);
    const schedule = row(owner.id);
    if (
      !schedule?.enabled ||
      schedule.nextRunAt === null ||
      schedule.nextRunAt > now()
    )
      return;
    const today = nutritionLocalDate(now(), schedule.timezone);
    const recentFrom = shiftDate(today, -6);
    const period = {
      from:
        schedule.initialFrom && schedule.initialFrom > recentFrom
          ? schedule.initialFrom
          : recentFrom,
      to: today,
    };
    try {
      await run(owner.id, period, { mode: 'scheduled' });
    } catch (error) {
      if (error instanceof NutritionSyncBusyError) return;
      // run records sanitized failure/backoff; no raw errors or credentials logged.
    }
  }
  return { enable, disable, status, run, tick };
}

function runtimeScheduler() {
  return createNutritionScheduler({
    database: getDatabase(),
    automaticEnabled: () =>
      !!globalScheduler.nutritionSchedulerTimer &&
      readServerEnv().ENABLE_NUTRITION_SCHEDULER === 'true' &&
      process.env.NODE_ENV === 'production' &&
      process.env.NEXT_PHASE !== 'phase-production-build',
    configured: () => {
      const env = readServerEnv();
      return !!env.YAZIO_TOKEN_FILE && !!env.BETTER_AUTH_SECRET;
    },
    store: (ownerId) => {
      // Settings consumes this service; runtime composition must not import it.
      const env = readServerEnv();
      if (!env.YAZIO_TOKEN_FILE || !env.BETTER_AUTH_SECRET)
        throw new NutritionScheduleError('NOT_CONFIGURED');
      const path = resolve(env.YAZIO_TOKEN_FILE);
      for (const directory of [resolve('public'), resolve(env.UPLOADS_DIR)])
        if (path === directory || path.startsWith(directory + sep))
          throw new NutritionScheduleError('NOT_CONFIGURED');
      return fileTokenStore(path, ownerId, env.BETTER_AUTH_SECRET);
    },
  });
}
export const enableNutritionSchedule = (
  ownerId: string,
  input: NutritionScheduleInput,
) => runtimeScheduler().enable(ownerId, input);
export const disableNutritionSchedule = (ownerId: string) =>
  runtimeScheduler().disable(ownerId);
export const getNutritionSchedule = (ownerId: string) =>
  runtimeScheduler().status(ownerId);
export const runNutritionSync = (
  ownerId: string,
  period: Period,
  options: RunOptions,
) => runtimeScheduler().run(ownerId, period, options);

const globalScheduler = globalThis as typeof globalThis & {
  nutritionSchedulerTimer?: ReturnType<typeof setInterval>;
};
export function startNutritionScheduler() {
  if (
    globalScheduler.nutritionSchedulerTimer ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  )
    return;
  const env = readServerEnv();
  if (
    env.ENABLE_NUTRITION_SCHEDULER !== 'true' ||
    !env.YAZIO_TOKEN_FILE ||
    !env.BETTER_AUTH_SECRET
  )
    return;
  // Registration only installs a timer; it does not read tokens or call upstream.
  globalScheduler.nutritionSchedulerTimer = setInterval(() => {
    void runtimeScheduler()
      .tick()
      .catch(() => {});
  }, 30000);
  globalScheduler.nutritionSchedulerTimer.unref();
}
export function stopNutritionScheduler() {
  clearInterval(globalScheduler.nutritionSchedulerTimer);
  delete globalScheduler.nutritionSchedulerTimer;
}
