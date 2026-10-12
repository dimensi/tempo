import 'server-only';
import { z } from 'zod';
import type { WorkoutPlan } from '@/contracts/workouts';
import type { TransformMateSyncData } from '@/contracts/transformmate';
import { transformMateSyncItemSchema } from '@/contracts/transformmate';
import {
  transformMateNativeQuerySchema,
  type TransformMateNativeQuery,
  type TransformMateNativeRefresh,
} from '@/contracts/transformmate-native';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import {
  getTransformMateBindingFence,
  getTransformMateConnectionFence,
} from '@/server/transformmate/runtime';
import { workoutRepository } from '@/server/workouts/repository';
import { TransformMateStorageError } from '@/server/transformmate/token-store';
import { syncRepository } from './repository';
import { nativeRepository } from './native-repository';
import { nativeService } from './native-service';
import { serializeOwner, syncEngine } from './engine';

export class SyncAccessError extends Error {
  constructor(public status: number) {
    super('Workout access denied');
  }
}
function context(headers: Headers, ownerId: string) {
  z.string().min(1).max(128).parse(ownerId);
  const access = async (permission: 'workouts:read' | 'workouts:plan') => {
    const result = await authorize(headers, permission, ownerId);
    if (!result.ok) throw new SyncAccessError(result.status);
  };
  const db = getDatabase().db;
  const repository = syncRepository(db);
  const plans = () => workoutRepository(db).list(ownerId).plans;
  return { access, repository, plans };
}
async function loadEngine(
  contextValue: ReturnType<typeof context>,
  ownerId: string,
) {
  await contextValue.access('workouts:read');
  try {
    const fence = await getTransformMateConnectionFence(ownerId);
    await contextValue.access('workouts:read');
    await fence?.assertCurrent();
    return {
      ...contextValue,
      client: fence?.client ?? null,
      checkConnection: fence?.assertCurrent,
      connectionId: fence?.generation,
      accountScope: fence?.accountScope,
    };
  } catch (error) {
    await contextValue.access('workouts:read');
    if (!(error instanceof TransformMateStorageError)) throw error;
    // A broken connection must not prevent a permitted local save. Stale epochs still reject.
    return {
      ...contextValue,
      client: null,
      checkConnection: undefined,
      connectionId: undefined,
      accountScope: undefined,
    };
  }
}
async function publishSavedPlan(
  contextValue: Awaited<ReturnType<typeof loadEngine>>,
  ownerId: string,
  plan: WorkoutPlan,
) {
  // Only the current owner-scoped persisted plan can authorize a new durable link.
  const current = contextValue
    .plans()
    .find(
      (p) =>
        p.id === plan.id &&
        p.ownerId === ownerId &&
        p.revision === plan.revision,
    );
  if (!current) return;
  await contextValue.access('workouts:plan');
  await contextValue.checkConnection?.();
  await contextValue.access('workouts:plan');
  contextValue.repository.ensure(ownerId, current);
  const engine = syncEngine(contextValue);
  for (const link of contextValue.repository
    .list(ownerId)
    .filter((l) => l.planId === plan.id))
    await engine.process(link);
  await contextValue.access('workouts:plan');
}

/** Keep local save/reconciliation and upstream claims in one owner queue; HTTP stays outside SQL. */
export async function saveAndSyncWorkoutPlan(
  headers: Headers,
  ownerId: string,
  save: () => WorkoutPlan,
): Promise<WorkoutPlan> {
  return serializeOwner(ownerId, async () => {
    const base = context(headers, ownerId);
    await base.access('workouts:plan');
    const contextValue = await loadEngine(base, ownerId);
    await contextValue.access('workouts:plan');
    await contextValue.checkConnection?.();
    await contextValue.access('workouts:plan');
    const plan = save();
    await publishSavedPlan(contextValue, ownerId, plan);
    return plan;
  });
}

export async function syncSavedPlan(
  headers: Headers,
  ownerId: string,
  plan: WorkoutPlan,
): Promise<void> {
  await serializeOwner(ownerId, async () => {
    const base = context(headers, ownerId);
    await base.access('workouts:plan');
    const contextValue = await loadEngine(base, ownerId);
    await publishSavedPlan(contextValue, ownerId, plan);
  });
}
export async function listTransformMateSync(
  headers: Headers,
  ownerId: string,
  input: TransformMateNativeQuery,
): Promise<TransformMateSyncData> {
  const query = transformMateNativeQuerySchema.parse(input);
  const { access, repository } = context(headers, ownerId);
  await access('workouts:read');
  const items = repository.list(ownerId).map((link) =>
    transformMateSyncItemSchema.parse({
      id: link.id,
      planId: link.planId,
      workoutId: link.workoutId,
      remoteTrainingId: link.remoteTrainingId,
      planSnapshot: {
        planTitle: link.state.planTitle,
        workout: link.state.workout,
      },
      ...(link.state.published
        ? {
            publishedSnapshot: {
              planTitle: link.state.published.planTitle,
              workout: link.state.published.workout,
            },
          }
        : {}),
      ...(link.state.updateAttempt
        ? {
            updateAttempt: {
              id: link.state.updateAttempt.id,
              phase: link.state.updateAttempt.phase,
              createdAt: link.state.updateAttempt.createdAt,
              checkedAt: link.state.updateAttempt.checkedAt,
            },
          }
        : {}),
      status: link.state.status,
      reason: link.state.reason,
      checkedAt: link.state.checkedAt,
      actual: link.state.actual,
    }),
  );
  await access('workouts:read');
  let binding: Awaited<ReturnType<typeof getTransformMateBindingFence>> | null =
    null;
  try {
    binding = await getTransformMateBindingFence(ownerId);
  } catch (error) {
    if (!(error instanceof TransformMateStorageError)) throw error;
  }
  await access('workouts:read');
  await binding?.assertCurrent();
  await access('workouts:read');
  const nativePage = binding?.accountScope
    ? nativeRepository(getDatabase().db).list(
        ownerId,
        binding.accountScope,
        query,
        new Set(
          repository
            .list(ownerId)
            .flatMap((link) =>
              link.remoteTrainingId === null ? [] : [link.remoteTrainingId],
            ),
        ),
      )
    : { items: [], nextCursor: null };
  return {
    configured: binding?.configured ?? false,
    items,
    nativePage,
    nativeRefresh: { status: 'idle', checkedAt: null, errorCode: null },
  };
}
export async function refreshTransformMateSync(
  headers: Headers,
  ownerId: string,
  input: TransformMateNativeQuery,
): Promise<TransformMateSyncData> {
  const query = transformMateNativeQuerySchema.parse(input);
  return serializeOwner(ownerId, async () => {
    const contextValue = context(headers, ownerId);
    await contextValue.access('workouts:read');
    const engine = syncEngine(await loadEngine(contextValue, ownerId));
    for (const link of contextValue.repository.list(ownerId))
      await engine.process(link);
    await contextValue.access('workouts:read');
    const connection = await getTransformMateConnectionFence(ownerId);
    const binding = connection ?? (await getTransformMateBindingFence(ownerId));
    await contextValue.access('workouts:read');
    await binding.assertCurrent();
    let nativeRefresh: TransformMateNativeRefresh = {
      status: 'unavailable',
      checkedAt: null,
      errorCode: null,
    };
    let nativeNextCursor: string | null = null;
    if (binding.accountScope) {
      const native = nativeService({
        ownerId,
        accountScope: binding.accountScope,
        client: connection?.client ?? null,
        repository: nativeRepository(getDatabase().db),
        access: () => contextValue.access('workouts:read'),
        checkConnection: binding.assertCurrent,
        linkedRemoteIds: () =>
          new Set(
            contextValue.repository
              .list(ownerId)
              .flatMap((link) =>
                link.remoteTrainingId === null ? [] : [link.remoteTrainingId],
              ),
          ),
      });
      const nativeResult = await native.refresh(query);
      nativeRefresh = nativeResult.refresh;
      nativeNextCursor = nativeResult.nextCursor;
    }
    const result = await listTransformMateSync(headers, ownerId, query);
    return {
      ...result,
      nativePage: {
        ...result.nativePage,
        nextCursor: nativeNextCursor ?? result.nativePage.nextCursor,
      },
      nativeRefresh,
    };
  });
}
