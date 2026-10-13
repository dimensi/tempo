import 'server-only';
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
  promise: Promise<void>;
  dates: Set<string>;
  manual: Set<string>;
  again: boolean;
  epoch: number | undefined;
};
const active = new Map<string, Work>();
export function runBodySync(
  ownerId: string,
  dates: string[] = [],
  measurementId?: string,
  expectedEpoch?: number,
): Promise<void> {
  const requestedEpoch =
    expectedEpoch ?? bodyRepository().schedule(ownerId)?.epoch;
  const existing = active.get(ownerId);
  if (existing) {
    if (existing.epoch !== requestedEpoch)
      return existing.promise
        .catch(() => {})
        .then(() => runBodySync(ownerId, dates, measurementId, requestedEpoch));
    for (const date of dates) existing.dates.add(date);
    if (measurementId) existing.manual.add(measurementId);
    existing.again = true;
    return existing.promise;
  }
  const work: Work = {
    promise: Promise.resolve(),
    dates: new Set(dates),
    manual: new Set(measurementId ? [measurementId] : []),
    again: true,
    epoch: requestedEpoch,
  };
  work.promise = Promise.resolve()
    .then(async () => {
      while (work.again) {
        work.again = false;
        const requestedDates = [...work.dates],
          requestedManual = new Set(work.manual);
        work.dates.clear();
        work.manual.clear();
        const database = getDatabase(),
          repo = bodyRepository(database),
          schedule = repo.schedule(ownerId);
        if (!schedule?.enabled || schedule.epoch !== requestedEpoch) return;
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
          await syncBodyJobs(
            ownerId,
            epoch,
            source,
            repo,
            fence,
            requestedManual,
          );
          await pullBodyDates(
            ownerId,
            epoch,
            requestedDates,
            source,
            repo,
            fence,
          );
        } catch {
          logicalFence();
          for (const job of repo.due(ownerId, epoch))
            if (job.state === 'pending' || job.state === 'failed')
              repo.jobState(job.id, 'failed', {
                attempt: job.attempt + 1,
                nextAttemptAt: Date.now() + 30_000,
              });
        }
      }
    })
    .finally(() => {
      if (active.get(ownerId) === work) active.delete(ownerId);
    });
  active.set(ownerId, work);
  return work.promise;
}
