import 'server-only';
import {
  nutritionDiagnostic,
  NutritionDiagnosticTransitions,
  type NutritionDiagnosticFields,
} from './nutrition-diagnostics';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import { syncReadFailure } from '@/server/yazio/sync-diagnostics';
import { runBodySync } from '@/server/yazio/body-runtime';
import { bodyRepository } from '@/server/yazio/body-repository';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { and, eq, gt, lte, or, isNull, sql } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { yazioSyncProgress } from '@/server/db/schema/yazio-sync-progress';
import { readServerEnv } from '@/server/env';
import {
  nutritionScheduleInputSchema,
  nutritionTimezoneSchema,
  type NutritionScheduleInput,
  type NutritionScheduleStatus,
} from '@/contracts/nutrition-schedule';
import {
  periodSchema,
  type NutritionActivity,
} from '@/contracts/nutrition-sync';
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
import { syncYazioSteps, syncYazioWeight } from './yazio-health-sync';
import { fetchCdnImage, storeImage } from '@/server/nutrition/images';
import { syncParts, syncProgress } from '@/server/yazio/sync-progress';

const HOUR = 3600000;
const LEASE_MS = 120000;
const HEARTBEAT_MS = 20000;
const MAX_RUN_MS = 2 * HOUR;
type Database = ReturnType<typeof getDatabase>;
type Period = { from: string; to: string };
type RunOptions = {
  mode: 'manual' | 'recent' | 'day-refresh' | 'automatic';
  timezone?: string;
  trigger?: 'timer' | 'overview';
};
type ErrorCode = NonNullable<NutritionScheduleStatus['lastError']>;
type ActiveRun = {
  id: string;
  epoch: number;
  activity: NutritionActivity | null;
};
type SchedulerActivity = {
  runs: Map<string, ActiveRun>;
  deliveries: Set<string>;
  diagnostics: NutritionDiagnosticTransitions;
};
// Instrumentation and API handlers can load separate module factories.
const globalScheduler = globalThis as typeof globalThis & {
  nutritionSchedulerTimer?: ReturnType<typeof setInterval>;
  nutritionSchedulerActivity?: WeakMap<object, SchedulerActivity>;
  nutritionSchedulerDiagnostics?: NutritionDiagnosticTransitions;
};
const runtimeDiagnostics = (globalScheduler.nutritionSchedulerDiagnostics ??=
  new NutritionDiagnosticTransitions());
const schedulerActivity = (globalScheduler.nutritionSchedulerActivity ??=
  new WeakMap());

function recentPeriod(today: string, days: number, initialFrom: string | null) {
  const from = shiftDate(today, 1 - days);
  return {
    from: initialFrom && initialFrom > from ? initialFrom : from,
    to: today,
  };
}

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
  configured: () => boolean;
  scheduled?: () => boolean;
  hasDueBodyWrites?: (ownerId: string, epoch: number) => boolean;
  deliverBodyWrites?: (ownerId: string) => Promise<void>;
  store: (ownerId: string) => YazioTokenStore;
  source?: (store: YazioTokenStore) => Promise<NutritionUpstream>;
  repository?: NutritionRepository;
  bodySync?: (
    ownerId: string,
    dates: string[],
    epoch: number,
    assertCurrent: () => void,
  ) => Promise<void>;
  healthRepository?: Pick<ReturnType<typeof yazioHealthRepository>, 'upsert'>;
  images?: { fetch: typeof fetchCdnImage; store: typeof storeImage };
}

// No authentication substitute: request entry points must authorize before calling
// these internal services. The scheduler independently selects/checks the DB OWNER.
export function createNutritionScheduler(deps: NutritionSchedulerDependencies) {
  const { db } = deps.database;
  const now = deps.now ?? Date.now;
  const repository = deps.repository ?? nutritionRepository(deps.database);
  const progress = syncProgress(deps.database);
  const {
    runs: active,
    deliveries,
    diagnostics,
  } = schedulerActivity.get(deps.database.sqlite) ?? {
    runs: new Map<string, ActiveRun>(),
    deliveries: new Set<string>(),
    diagnostics: new NutritionDiagnosticTransitions(),
  };
  schedulerActivity.set(deps.database.sqlite, {
    runs: active,
    deliveries,
    diagnostics,
  });
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
    db.transaction(() => {
      ensure(ownerId);
      // Explicit credentials/token replacement invalidates the previous account's checkpoints.
      db.delete(yazioSyncProgress)
        .where(eq(yazioSyncProgress.ownerId, ownerId))
        .run();
      db.update(nutritionSchedule)
        .set({
          enabled: true,
          timezone: input.timezone,
          initialFrom: input.initialFrom,
          epoch: sql`${nutritionSchedule.epoch} + 1`,
          nextRunAt: null,
          automaticAttemptAt: null,
          recentSuccessAt: null,
          recentSuccessDate: null,
          attempt: 0,
          lastError: null,
        })
        .where(ownerScope(ownerId))
        .run();
    });
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
      automaticAvailable: deps.configured(),
      scheduled: deps.scheduled?.() ?? false,
      timezone: current?.timezone ?? 'UTC',
      initialFrom: current?.initialFrom ?? null,
      lastSuccess: iso(current?.lastSuccess ?? null),
      lastError: current?.lastError ?? null,
      attempt: current?.attempt ?? 0,
      running: !!current?.leaseId && (current.leaseExpiresAt ?? 0) > now(),
    };
  }
  function liveStatus(ownerId: string) {
    requireOwner(ownerId);
    const current = row(ownerId);
    const running = active.get(ownerId);
    return {
      activity:
        running &&
        running.id === current?.leaseId &&
        running.epoch === current.epoch &&
        (current.leaseExpiresAt ?? 0) > now()
          ? running.activity
          : null,
      last: repository.status(ownerId),
      schedule: {
        lastSuccess: iso(current?.lastSuccess ?? null),
        lastAttempt: iso(current?.automaticAttemptAt ?? null),
        hasError: Boolean(current?.lastError),
        scheduled: !!current?.enabled && (deps.scheduled?.() ?? false),
      },
    };
  }
  async function run(ownerId: string, raw: Period, options: RunOptions) {
    const period = periodSchema.parse(raw);
    if (options.timezone) nutritionTimezoneSchema.parse(options.timezone);
    requireOwner(ownerId);
    if (active.has(ownerId) || deliveries.has(ownerId))
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
          ...(options.mode === 'automatic'
            ? { automaticAttemptAt: started }
            : {}),
        })
        .where(
          and(
            ownerScope(ownerId),
            or(
              isNull(nutritionSchedule.leaseId),
              lte(nutritionSchedule.leaseExpiresAt, started),
            ),
            ...(options.mode === 'automatic'
              ? [
                  eq(nutritionSchedule.enabled, true),
                  or(
                    isNull(nutritionSchedule.automaticAttemptAt),
                    lte(nutritionSchedule.automaticAttemptAt, started - HOUR),
                  ),
                  or(
                    isNull(nutritionSchedule.recentSuccessAt),
                    lte(nutritionSchedule.recentSuccessAt, started - HOUR),
                    sql`${nutritionSchedule.recentSuccessDate} != ${period.to}`,
                  ),
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
    const activeRun: ActiveRun = {
      id: leaseId,
      epoch: acquired.epoch,
      activity: null,
    };
    active.set(ownerId, activeRun);
    diagnostics.clear(`skip:timer:${ownerId}`);
    diagnostics.clear(`skip:overview:${ownerId}`);
    const context = {
      runId: leaseId,
      mode: options.mode,
      trigger: options.trigger ?? ('request' as const),
    };
    nutritionDiagnostic('sync_started', context);
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
    function complete(
      error: ErrorCode | null,
      foodSucceeded = false,
      recentSuccessDate: string | null = null,
    ) {
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
                (date) =>
                  !status.completedDates.includes(date) &&
                  !status.skippedDates.includes(date),
              ),
            });
        }
        db.update(nutritionSchedule)
          .set({
            lastSuccess: foodSucceeded ? now() : current.lastSuccess,
            lastError: error,
            attempt: error ? Math.min(current.attempt + 1, 3) : 0,
            nextRunAt: null,
            ...(recentSuccessDate
              ? { recentSuccessAt: now(), recentSuccessDate }
              : {}),
          })
          .where(condition)
          .run();
      });
    }
    let foodCompleted = false;
    let heartbeatFailed = false;
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
        } catch (error) {
          // A failed heartbeat still expires/fences the lease; report once per run.
          if (!heartbeatFailed)
            nutritionDiagnostic(
              'sync_auxiliary_failed',
              { ...context, stage: 'heartbeat' },
              error,
            );
          heartbeatFailed = true;
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
      if (created && (options.mode === 'manual' || options.mode === 'recent')) {
        // A legacy connected owner may manually sync before the first timer
        // adoption. Only this freshly inserted row can be enabled here; an
        // explicit disable/reconnect increments epoch and defeats this fence.
        db.update(nutritionSchedule)
          .set({ enabled: true })
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
      const timezone = options.timezone ?? acquired.timezone;
      const today = nutritionLocalDate(now(), timezone);
      const dates = periodDates(period);
      if (options.mode === 'automatic' || options.mode === 'recent')
        dates.reverse();
      const force = options.mode === 'day-refresh' || options.mode === 'recent';
      const work = progress.plan(ownerId, dates, today, force);
      assertCurrent();
      db.transaction(() => {
        for (const [date, parts] of work) {
          const pendingParts = Object.fromEntries(
            syncParts
              .filter((part) => parts[part])
              .map((part) => [part, false]),
          );
          if (Object.keys(pendingParts).length)
            progress.set(ownerId, date, pendingParts);
        }
      });
      const pendingDates = (part: 'steps' | 'food' | 'photos') =>
        dates.filter((date) => work.get(date)?.[part]);
      const activity: NutritionActivity = {
        id: leaseId,
        revision: 0,
        steps: pendingDates('steps'),
        food: pendingDates('food'),
        photos: pendingDates('photos'),
        other: true,
      };
      activeRun.activity = activity;
      function settle(part: 'steps' | 'food' | 'photos', date: string) {
        activity[part] = activity[part].filter((pending) => pending !== date);
        activity.revision++;
      }
      const observedAt = new Date(now()).toISOString();
      const healthRepository =
        deps.healthRepository ?? yazioHealthRepository(db);
      const steps = syncYazioSteps(
        ownerId,
        work,
        guardedSource,
        healthRepository,
        assertCurrent,
        observedAt,
        (date) => settle('steps', date),
      );
      const nutrition = syncNutritionPeriod(
        ownerId,
        period,
        guardedSource,
        guardedRepository,
        {
          async fetch(url) {
            assertCurrent();
            return track(() => (deps.images?.fetch ?? fetchCdnImage)(url));
          },
          async store(bytes, mime) {
            assertCurrent();
            return track(() => (deps.images?.store ?? storeImage)(bytes, mime));
          },
        },
        {
          work,
          force,
          beforePhotos: async () => {
            await steps;
          },
          onFoodSettled: (date) => settle('food', date),
          onPhotosSettled: (date) => settle('photos', date),
        },
      );
      const auxiliary = steps.then(async () => {
        const completedGoals = new Set<string>();
        const failedGoalsDates: string[] = [];
        for (const date of work.keys()) {
          const goalStarted = Date.now();
          try {
            const goal = await guardedSource.goals(date);
            assertCurrent();
            dailyGoalsRepository(deps.database).save(ownerId, {
              ...goal,
              fetchedAt: new Date(now()).toISOString(),
            });
            completedGoals.add(date);
            activity.revision++;
          } catch (error) {
            assertCurrent();
            syncReadFailure('goals', date, goalStarted, error);
            failedGoalsDates.push(date);
          }
        }
        const weight = await syncYazioWeight(
          ownerId,
          work,
          guardedSource,
          healthRepository,
          assertCurrent,
          observedAt,
        );
        assertCurrent();
        activity.revision++;
        return { completedGoals, failedGoalsDates, ...weight };
      });
      const settled = await Promise.allSettled([nutrition, steps, auxiliary]);
      const failure = settled.find((entry) => entry.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const [
        result,
        stepResult,
        { completedGoals, failedGoalsDates, ...weightResult },
      ] = await Promise.all([nutrition, steps, auxiliary]);
      assertCurrent();
      // Body sync uses its own auth client. Start it after the nutrition client
      // has finished upstream reads so both cannot refresh the same token at once.
      let bodyFailed = false;
      await deps
        .bodySync?.(
          ownerId,
          [...work].filter(([, parts]) => parts.body).map(([date]) => date),
          acquired.epoch,
          assertCurrent,
        )
        .catch((error: unknown) => {
          bodyFailed = true;
          nutritionDiagnostic(
            'sync_auxiliary_failed',
            { ...context, stage: 'body' },
            error,
          );
        });
      assertCurrent();
      activity.other = false;
      activity.revision++;
      const health = {
        ...stepResult,
        ...weightResult,
        error:
          stepResult.failedStepsDates.length ||
          weightResult.failedWeightDates.length
            ? ('HEALTH_IMPORT_FAILED' as const)
            : null,
      };
      const status = {
        ...result,
        failedStepsDates: health.failedStepsDates,
        failedWeightDates: health.failedWeightDates,
        failedGoalsDates,
      };
      repository.saveStatus(ownerId, status);
      const foodSucceeded = result.failedDates.length === 0;
      const selectedFoodOrPhotos = [...work.values()].some(
        (parts) => parts.food || parts.photos,
      );
      const expected = recentPeriod(
        today,
        2,
        row(ownerId)?.initialFrom ?? null,
      );
      const recentSucceeded =
        expected.from <= expected.to &&
        periodDates(expected).every(
          (date) =>
            completedGoals.has(date) &&
            health.completedStepsDates.includes(date) &&
            result.completedDates.includes(date),
        );
      if (selectedFoodOrPhotos)
        complete(
          !foodSucceeded
            ? 'SYNC_FAILED'
            : result.photoFailedDates.length
              ? 'PHOTO_INCOMPLETE'
              : null,
          foodSucceeded,
          recentSucceeded ? today : null,
        );
      foodCompleted = true;
      const failures = {
        foodFailures: result.failedDates.length,
        photoFailures: result.photoFailedDates.length,
        stepsFailures: health.failedStepsDates.length,
        weightFailures: health.failedWeightDates.length,
        goalsFailures: failedGoalsDates.length,
        bodyFailed,
      };
      nutritionDiagnostic('sync_completed', {
        ...context,
        durationMs: now() - started,
        outcome: !foodSucceeded
          ? 'failed'
          : Object.values(failures).some(Boolean) || heartbeatFailed
            ? 'partial'
            : 'success',
        ...failures,
      });
      return { ...status, health };
    } catch (error) {
      const code =
        error instanceof NutritionScheduleError ? error.code : 'SYNC_FAILED';
      nutritionDiagnostic(
        'sync_failed',
        { ...context, code, durationMs: now() - started },
        error,
      );
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
      } catch (error) {
        nutritionDiagnostic(
          'sync_auxiliary_failed',
          { ...context, stage: 'lease_release' },
          error,
        );
        throw error;
      } finally {
        active.delete(ownerId);
      }
    }
  }
  async function overview(ownerId: string, timezone: string) {
    nutritionTimezoneSchema.parse(timezone);
    requireOwner(ownerId);
    if (!deps.configured()) {
      diagnostics.log(`skip:overview:${ownerId}`, 'scheduler_skipped', {
        trigger: 'overview',
        reason: 'connection_not_configured',
      });
      return { started: false };
    }
    // Adopt a saved token only when this owner has no connection row. An explicit
    // disconnect already has a disabled row and can never be re-enabled here.
    if (!row(ownerId)) {
      const connected = !!(await deps.store(ownerId).load());
      requireOwner(ownerId);
      db.insert(nutritionSchedule)
        .values({ ownerId, enabled: connected, timezone })
        .onConflictDoNothing()
        .run();
    }
    return automatic(ownerId, 'overview');
  }
  async function automatic(ownerId: string, trigger: 'timer' | 'overview') {
    const skip = (
      reason: NutritionDiagnosticFields['reason'],
      nextEligibleAt?: number,
    ) => {
      diagnostics.log(`skip:${trigger}:${ownerId}`, 'scheduler_skipped', {
        trigger,
        reason,
        ...(nextEligibleAt === undefined
          ? {}
          : { nextEligibleAt: new Date(nextEligibleAt).toISOString() }),
      });
      return { started: false };
    };
    const current = row(ownerId);
    if (!current?.enabled) return skip('connection_disabled');
    const timezone = current.timezone;
    const today = nutritionLocalDate(now(), timezone);
    const period = recentPeriod(today, 2, current.initialFrom);
    if (period.from > period.to) return skip('history_start_in_future');
    try {
      await run(ownerId, period, { mode: 'automatic', timezone, trigger });
      return { started: true };
    } catch (error) {
      if (error instanceof NutritionSyncBusyError) {
        // Classify only after the authoritative atomic claim rejects; logging must
        // not introduce a second eligibility gate or change lease/cooldown rules.
        const latest = row(ownerId);
        const time = now();
        if (
          active.has(ownerId) ||
          deliveries.has(ownerId) ||
          (latest?.leaseExpiresAt ?? 0) > time
        )
          return skip('run_in_progress');
        if (!latest?.enabled) return skip('connection_disabled');
        const attemptDue =
          latest.automaticAttemptAt === null
            ? 0
            : latest.automaticAttemptAt + HOUR;
        const successDue =
          latest.recentSuccessAt !== null && latest.recentSuccessDate === today
            ? latest.recentSuccessAt + HOUR
            : 0;
        if (attemptDue > time)
          return skip('attempt_cooldown', Math.max(attemptDue, successDue));
        if (successDue > time) return skip('recent_success', successDue);
        return skip('lease_conflict');
      }
      throw error;
    }
  }
  async function recent(ownerId: string, timezone: string) {
    requireOwner(ownerId);
    const current = row(ownerId);
    const zone = current?.initialFrom ? current.timezone : timezone;
    const today = nutritionLocalDate(now(), zone);
    return run(ownerId, recentPeriod(today, 7, current?.initialFrom ?? null), {
      mode: 'recent',
      timezone: zone,
    });
  }
  async function scheduled() {
    const owners = db
      .select({ ownerId: nutritionSchedule.ownerId })
      .from(nutritionSchedule)
      .where(eq(nutritionSchedule.enabled, true))
      .all();
    if (!owners.length)
      diagnostics.log('owners', 'scheduler_skipped', {
        trigger: 'timer',
        reason: 'no_enabled_owners',
      });
    else diagnostics.clear('owners');
    await Promise.all(
      owners
        .map(async ({ ownerId }) => {
          const reportFailure = (error: unknown) =>
            diagnostics.log(
              `failure:${ownerId}`,
              'scheduler_failed',
              { trigger: 'timer', stage: 'owner' },
              error,
            );
          const refresh = await automatic(ownerId, 'timer').catch(
            (error: unknown) => {
              reportFailure(error);
              return null;
            },
          );
          const current = row(ownerId);
          if (
            refresh?.started ||
            !current?.enabled ||
            active.has(ownerId) ||
            deliveries.has(ownerId) ||
            (current.leaseExpiresAt ?? 0) > now() ||
            !deps.hasDueBodyWrites?.(ownerId, current.epoch)
          )
            return;
          deliveries.add(ownerId);
          try {
            await deps.deliverBodyWrites?.(ownerId);
          } finally {
            deliveries.delete(ownerId);
          }
        })
        .map((operation) =>
          operation.catch((error: unknown) => {
            diagnostics.log(
              'owner_failure',
              'scheduler_failed',
              { trigger: 'timer', stage: 'owner' },
              error,
            );
          }),
        ),
    );
  }
  return {
    enable,
    disable,
    status,
    liveStatus,
    run,
    overview,
    recent,
    scheduled,
  };
}

function runtimeScheduler() {
  return createNutritionScheduler({
    database: getDatabase(),
    scheduled: () =>
      readServerEnv().ENABLE_NUTRITION_SCHEDULER === 'true' &&
      Boolean(
        readServerEnv().YAZIO_TOKEN_FILE && readServerEnv().BETTER_AUTH_SECRET,
      ),
    hasDueBodyWrites: (ownerId, epoch) =>
      bodyRepository().due(ownerId, epoch).length > 0,
    deliverBodyWrites: runBodySync,
    bodySync: (ownerId, dates, epoch, assertCurrent) =>
      runBodySync(ownerId, dates, undefined, epoch, assertCurrent),
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
export const getNutritionLiveStatus = (ownerId: string) =>
  runtimeScheduler().liveStatus(ownerId);
export const refreshRecentNutrition = (ownerId: string, timezone: string) =>
  runtimeScheduler().recent(ownerId, timezone);
export const refreshOverviewNutrition = (ownerId: string, timezone: string) =>
  runtimeScheduler().overview(ownerId, timezone);
export const runNutritionSync = (
  ownerId: string,
  period: Period,
  options: RunOptions,
) => runtimeScheduler().run(ownerId, period, options);

export function startNutritionScheduler() {
  if (
    globalScheduler.nutritionSchedulerTimer ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  )
    return;
  if (process.env.ENABLE_NUTRITION_SCHEDULER !== 'true') {
    runtimeDiagnostics.log('registration', 'scheduler_disabled', {
      reason: 'feature_flag_disabled',
    });
    return;
  }
  try {
    const env = readServerEnv();
    if (!env.YAZIO_TOKEN_FILE || !env.BETTER_AUTH_SECRET) {
      runtimeDiagnostics.log('registration', 'scheduler_disabled', {
        reason: 'connection_not_configured',
      });
      return;
    }
    // Registration only installs a timer; no YAZIO request runs during startup.
    // Promise.resolve also catches synchronous composition/DB errors on a tick.
    globalScheduler.nutritionSchedulerTimer = setInterval(() => {
      void Promise.resolve()
        .then(() => runtimeScheduler().scheduled())
        .then(
          () => runtimeDiagnostics.clear('tick'),
          (error: unknown) =>
            runtimeDiagnostics.log(
              'tick',
              'scheduler_failed',
              { trigger: 'timer', stage: 'tick' },
              error,
            ),
        );
    }, 30000);
    globalScheduler.nutritionSchedulerTimer.unref();
    runtimeDiagnostics.clear('registration');
    nutritionDiagnostic('scheduler_started', { intervalMs: 30000 });
  } catch (error) {
    nutritionDiagnostic('scheduler_failed', { stage: 'registration' }, error);
    throw error;
  }
}
export function stopNutritionScheduler() {
  if (!globalScheduler.nutritionSchedulerTimer) return;
  clearInterval(globalScheduler.nutritionSchedulerTimer);
  delete globalScheduler.nutritionSchedulerTimer;
  runtimeDiagnostics.clear('tick');
  nutritionDiagnostic('scheduler_stopped');
}
