import 'server-only';
import { z } from 'zod';
import type { WorkoutPlan } from '@/contracts/workouts';
import type { TransformMateSyncData } from '@/contracts/transformmate';
import { transformMateSyncItemSchema } from '@/contracts/transformmate';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import {
  isTransformMateConfigured,
  getTransformMateConnectionFence,
} from '@/server/transformmate/runtime';
import { workoutRepository } from '@/server/workouts/repository';
import { TransformMateStorageError } from '@/server/transformmate/token-store';
import { syncRepository } from './repository';
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
): Promise<TransformMateSyncData> {
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
  let configured = false;
  try {
    configured = await isTransformMateConfigured(ownerId);
  } catch (error) {
    if (!(error instanceof TransformMateStorageError)) throw error;
  }
  await access('workouts:read');
  return { configured, items };
}
export async function refreshTransformMateSync(
  headers: Headers,
  ownerId: string,
): Promise<TransformMateSyncData> {
  return serializeOwner(ownerId, async () => {
    const contextValue = context(headers, ownerId);
    await contextValue.access('workouts:read');
    const engine = syncEngine(await loadEngine(contextValue, ownerId));
    for (const link of contextValue.repository.list(ownerId))
      await engine.process(link);
    return listTransformMateSync(headers, ownerId);
  });
}
