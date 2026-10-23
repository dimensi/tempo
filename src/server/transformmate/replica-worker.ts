import 'server-only';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getDatabase } from '@/server/db';
import { getObjectStorage } from '@/server/storage';
import { workoutRepository } from '@/server/workouts/repository';
import { getTransformMateConnectionFence } from './runtime';
import { catalogStore } from './catalog-store';
import {
  cachedDetail,
  refreshFull,
  refreshDictionary,
  type CatalogScope,
} from './catalog-cache';
import {
  replicaStore,
  monthFrom,
  type ReplicaJob,
  type createReplicaStore,
} from './replica-store';
import { processReplicaMedia, replicaTemporaryRoot } from './replica-media';
import {
  recordReplicaFailure,
  unchangedReplicaFailure,
  ReplicaStorageError,
  ReplicaStageError,
  replicaFailureInfo,
} from './replica-gate';
import { TransformMateStaleConnectionError } from './token-store';

type Store = ReturnType<typeof createReplicaStore>;
export function createReplicaWorker(deps: {
  store: Store;
  refresh: (
    scope: CatalogScope,
    job: ReplicaJob,
    save: () => Promise<void>,
  ) => Promise<void>;
  assertOwner: (scope: CatalogScope) => void;
  now?: () => number;
  random?: () => number;
}) {
  let running = false;
  return {
    async tick(scope: CatalogScope) {
      if (running || !scope.client) return;
      running = true;
      const now = deps.now ?? Date.now,
        random = deps.random ?? Math.random;
      try {
        deps.assertOwner(scope);
        const state = deps.store.state(scope),
          at = now();
        if (
          state.reason === 'auth' ||
          state.blocked_until > at ||
          state.next_request_at > at
        )
          return;
        const job = deps.store.next(scope, at);
        if (!job) return;
        const save = async () => {
          await scope.assertUpstreamCurrent();
          deps.assertOwner(scope);
          deps.store.save(scope, job);
        };
        try {
          await scope.assertUpstreamCurrent();
          await deps.refresh(scope, job, save);
          await scope.assertUpstreamCurrent();
          deps.assertOwner(scope);
          job.attempts = 0;
          delete job.data.failures.job;
          job.priority = 0;
          job.next_at = job.key.startsWith('exercise:')
            ? Math.min(
                job.data.detailAt,
                job.data.imageAt,
                job.data.videoAt,
                job.data.posterAt,
              )
            : monthFrom(now(), random);
          await save();
          deps.store.patch(scope, {
            ...(unchangedReplicaFailure(deps.store.state(scope), state)
              ? { failures: 0, reason: null, blocked_until: 0 }
              : {}),
            last_success_at: now(),
          });
        } catch (error) {
          if (error instanceof TransformMateStaleConnectionError) return;
          try {
            await scope.assertUpstreamCurrent();
            deps.assertOwner(scope);
            job.attempts = Math.min(job.attempts + 1, 20);
            if (error instanceof ReplicaStageError) {
              delete job.data.failures.job;
              job.data.failures[error.stage] = replicaFailureInfo(error);
            } else job.data.failures.job = replicaFailureInfo(error);
            job.next_at =
              now() +
              Math.min(
                21600000,
                60000 * 2 ** (job.attempts - 1) * (1 + random() * 0.2),
              );
            await save();
            recordReplicaFailure(scope, error, now());
          } catch {
            /* Replaced bindings may neither publish nor update old jobs. */
          }
        } finally {
          deps.store.patch(scope, {
            next_request_at: now() + 6000 + Math.floor(random() * 3001),
          });
        }
      } finally {
        running = false;
      }
    },
  };
}
function requireOwner(scope: CatalogScope) {
  if (
    !getDatabase()
      .sqlite.prepare("SELECT 1 FROM user WHERE id=? AND role='OWNER'")
      .get(scope.ownerId)
  )
    throw new TransformMateStaleConnectionError();
}
async function runtimeScope(ownerId: string): Promise<CatalogScope | null> {
  const fence = await getTransformMateConnectionFence(ownerId);
  if (!fence) return null;
  const assertCurrent = async () => {
    await fence.assertCurrent();
    fence.assertBindingCurrent();
  };
  return {
    ownerId,
    accountScope: fence.accountScope,
    locale: 'ru',
    client: fence.client,
    assertCurrent,
    assertUpstreamCurrent: assertCurrent,
  };
}
export async function refreshReplicaJob(
  scope: CatalogScope,
  job: ReplicaJob,
  save: () => Promise<void>,
) {
  const store = replicaStore();
  if (job.key === 'catalog') {
    await refreshFull(scope);
    for (const row of catalogStore().records(scope, true))
      store.enqueue(scope, `exercise:${row.id}`);
    return;
  }
  if (job.key === 'dictionary') {
    await refreshDictionary(scope);
    return;
  }
  const id = Number(job.key.slice('exercise:'.length)),
    now = Date.now();
  let metadataFailure: unknown;
  if (job.data.detailAt <= now) {
    try {
      await cachedDetail(scope, id, true);
      job.data.detailAt = monthFrom(now);
      delete job.data.failures.metadata;
      await save();
    } catch (error) {
      if (error instanceof TransformMateStaleConnectionError) throw error;
      job.data.failures.metadata = replicaFailureInfo(error);
      await save();
      const stageError = new ReplicaStageError('metadata', error);
      if (!catalogStore().record(scope, id)?.detail) throw stageError;
      // Existing media can still make progress when upstream metadata is gone.
      metadataFailure = stageError;
    }
  }
  const record = catalogStore().record(scope, id);
  if (!record?.detail) throw new Error('Missing exercise detail');
  const storage = getObjectStorage();
  // Before any expensive CDN transfer, verify this storage can accept writes.
  try {
    await storage.put(
      `transformmate/probe/${scope.accountScope}`,
      new Uint8Array([1]),
      'application/octet-stream',
    );
  } catch {
    throw new ReplicaStorageError();
  }
  await processReplicaMedia(
    scope,
    job,
    record.detail,
    storage,
    save,
    now,
    metadataFailure ? 'poster' : 'all',
  );
  if (metadataFailure) throw metadataFailure;
}
const runtime = globalThis as typeof globalThis & {
  transformMateReplicaLoop?: {
    timer: ReturnType<typeof setTimeout>;
    stopping: boolean;
    active: boolean;
  };
};
export function startTransformMateReplicaWorker() {
  if (
    runtime.transformMateReplicaLoop ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  )
    return;
  const worker = createReplicaWorker({
    store: replicaStore(),
    refresh: refreshReplicaJob,
    assertOwner: requireOwner,
  });
  const adopted = new Set<string>();
  let cleaned = false;
  let plansCheckedAt = 0;
  const loop = {
    timer: setTimeout(() => {}, 0),
    stopping: false,
    active: false,
  };
  runtime.transformMateReplicaLoop = loop;
  async function tick() {
    if (loop.stopping) return;
    loop.active = true;
    try {
      if (!cleaned) {
        // These names belong exclusively to this worker in the supported single-process runtime.
        const root = replicaTemporaryRoot();
        await mkdir(root, { recursive: true, mode: 0o700 });
        for (const name of await readdir(root))
          await rm(join(root, name), { recursive: true, force: true });
        cleaned = true;
      }
      const owner = getDatabase()
        .sqlite.prepare("SELECT id FROM user WHERE role='OWNER'")
        .get() as { id: string } | undefined;
      if (owner) {
        const scope = await runtimeScope(owner.id);
        if (scope) {
          const store = replicaStore();
          const state = store.state(scope);
          const fence = await getTransformMateConnectionFence(owner.id);
          if (fence && state.connection_id !== fence.generation)
            store.patch(scope, {
              connection_id: fence.generation,
              ...(state.reason === 'auth'
                ? { reason: null, failures: 0, blocked_until: 0 }
                : {}),
            });
          const key = JSON.stringify([owner.id, scope.accountScope]);
          if (!adopted.has(key)) {
            store.bootstrap(scope);
            adopted.add(key);
            plansCheckedAt = 0;
          }
          if (Date.now() - plansCheckedAt >= 60000) {
            const workouts = workoutRepository(getDatabase().db).list(
              owner.id,
            ).workouts;
            for (const workout of workouts)
              for (const exercise of workout.exercises)
                if (exercise.transformMate)
                  store.enqueue(
                    scope,
                    `exercise:${exercise.transformMate.exerciseId}`,
                    0,
                    100,
                  );
            plansCheckedAt = Date.now();
          }
          await worker.tick(scope);
        }
      }
      for (const { key } of replicaStore().garbageDue(Date.now())) {
        if (replicaStore().isReferenced(key)) {
          replicaStore().garbageDone(key);
          continue;
        }
        try {
          await getObjectStorage().remove(key);
          replicaStore().garbageDone(key);
        } catch {
          replicaStore().garbageRetry(key, Date.now());
        }
      }
    } catch {
      /* No raw provider errors, signed URLs or credentials in logs. Persistent job status reports failures. */
    } finally {
      loop.active = false;
      if (!loop.stopping) {
        loop.timer = setTimeout(() => void tick(), 1000);
        loop.timer.unref();
      }
    }
  }
  clearTimeout(loop.timer);
  loop.timer = setTimeout(() => void tick(), 0);
  loop.timer.unref();
  process.once('SIGTERM', () => {
    loop.stopping = true;
    clearTimeout(loop.timer);
  });
}
