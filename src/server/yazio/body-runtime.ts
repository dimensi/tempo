import 'server-only';
import { NutritionDiagnosticTransitions } from '@/server/jobs/nutrition-diagnostics';
export type BodySyncResult = { failed: boolean };
const diagnostics = new NutritionDiagnosticTransitions();
import { resolve, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { readServerEnv } from '@/server/env';
import { fileTokenStore } from './token-store';
import { bodyUpstream } from './body-adapter';
import { bodyRepository } from './body-repository';
import { syncBodyJobs, pullBodyDates } from '@/server/jobs/yazio-body-sync';
type Work = {
  promise: Promise<BodySyncResult>;
  dates: Set<string>;
  manual: Set<string>;
  again: boolean;
  epoch: number | undefined;
  guards: Map<string, () => void>;
};
const active = new Map<string, Work>();
export function runBodySync(
  ownerId: string,
  dates: string[] = [],
  measurementId?: string,
  expectedEpoch?: number,
  assertPullCurrent?: () => void,
): Promise<BodySyncResult> {
  const requestedEpoch =
    expectedEpoch ?? bodyRepository().schedule(ownerId)?.epoch;
  const existing = active.get(ownerId);
  if (existing) {
    if (existing.epoch !== requestedEpoch)
      return existing.promise
        .catch(() => {})
        .then(() =>
          runBodySync(
            ownerId,
            dates,
            measurementId,
            requestedEpoch,
            assertPullCurrent,
          ),
        );
    for (const date of dates) existing.dates.add(date);
    if (assertPullCurrent)
      for (const date of dates) existing.guards.set(date, assertPullCurrent);
    if (measurementId) existing.manual.add(measurementId);
    existing.again = true;
    return existing.promise;
  }
  const work: Work = {
    promise: Promise.resolve({ failed: false }),
    dates: new Set(dates),
    manual: new Set(measurementId ? [measurementId] : []),
    again: true,
    epoch: requestedEpoch,
    guards: new Map(
      dates.flatMap((date) =>
        assertPullCurrent ? [[date, assertPullCurrent] as const] : [],
      ),
    ),
  };
  work.promise = Promise.resolve()
    .then(async () => {
      const result: BodySyncResult = { failed: false };
      while (work.again) {
        work.again = false;
        const requestedDates = [...work.dates],
          requestedGuards = new Map(work.guards),
          requestedManual = new Set(work.manual);
        work.dates.clear();
        work.guards.clear();
        work.manual.clear();
        const database = getDatabase(),
          repo = bodyRepository(database),
          schedule = repo.schedule(ownerId);
        if (!schedule?.enabled || schedule.epoch !== requestedEpoch)
          return { failed: true };
        const epoch = schedule.epoch;
        const logicalFence = () => {
          repo.assertEpoch(ownerId, epoch);
          if (
            !database.db
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.id, ownerId), eq(user.role, 'OWNER')))
              .get()
          )
            throw new Error('Body owner changed');
        };
        try {
          const env = readServerEnv();
          if (!env.YAZIO_TOKEN_FILE || !env.BETTER_AUTH_SECRET)
            throw new Error('Body storage unavailable');
          const path = resolve(env.YAZIO_TOKEN_FILE);
          for (const directory of [resolve('public'), resolve(env.UPLOADS_DIR)])
            if (path === directory || path.startsWith(directory + sep))
              throw new Error('Body storage unavailable');
          const store = fileTokenStore(path, ownerId, env.BETTER_AUTH_SECRET);
          const fence = async () => {
            logicalFence();
            await store.assertCurrent?.();
            logicalFence();
          };
          const source = await bodyUpstream({
            load: async () => {
              logicalFence();
              const token = await store.load();
              await fence();
              return token;
            },
            save: async (token) => {
              await fence();
              await store.save(token);
              await fence();
            },
            assertCurrent: fence,
          });
          const writesIncomplete = await syncBodyJobs(
            ownerId,
            epoch,
            source,
            repo,
            fence,
            requestedManual,
          );
          const readsFailed = await pullBodyDates(
            ownerId,
            epoch,
            requestedDates,
            source,
            repo,
            fence,
            (date) => requestedGuards.get(date)?.(),
          );
          if (writesIncomplete || readsFailed) {
            result.failed = true;
            diagnostics.log(ownerId, 'sync_auxiliary_failed', {
              stage: 'body',
              bodyFailed: true,
            });
          } else diagnostics.clear(ownerId);
        } catch (error) {
          result.failed = true;
          diagnostics.log(
            ownerId,
            'sync_auxiliary_failed',
            { stage: 'body', bodyFailed: true },
            error,
          );
          logicalFence();
          for (const job of repo.due(ownerId, epoch))
            if (job.state === 'pending' || job.state === 'failed')
              repo.jobState(job.id, 'failed', {
                attempt: job.attempt + 1,
                nextAttemptAt: Date.now() + 30_000,
              });
        }
      }
      return result;
    })
    .finally(() => {
      if (active.get(ownerId) === work) active.delete(ownerId);
    });
  active.set(ownerId, work);
  return work.promise;
}
