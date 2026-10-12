import 'server-only';
import { z } from 'zod';
import type { WorkoutPlan } from '@/contracts/workouts';
import type { TransformMateSyncData } from '@/contracts/transformmate';
import { transformMateSyncItemSchema } from '@/contracts/transformmate';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import {
  getTransformMateClient,
  isTransformMateConfigured,
} from '@/server/transformmate/runtime';
import { workoutRepository } from '@/server/workouts/repository';
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
export async function syncSavedPlan(
  headers: Headers,
  ownerId: string,
  plan: WorkoutPlan,
): Promise<void> {
  await serializeOwner(ownerId, async () => {
    const contextValue = context(headers, ownerId);
    await contextValue.access('workouts:plan');
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
    contextValue.repository.ensure(ownerId, current);
    const engine = syncEngine({
      ...contextValue,
      client: getTransformMateClient(),
    });
    for (const link of contextValue.repository
      .list(ownerId)
      .filter((l) => l.planId === plan.id))
      await engine.process(link);
    await contextValue.access('workouts:plan');
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
      status: link.state.status,
      reason: link.state.reason,
      checkedAt: link.state.checkedAt,
      actual: link.state.actual,
    }),
  );
  await access('workouts:read');
  return { configured: isTransformMateConfigured(), items };
}
export async function refreshTransformMateSync(
  headers: Headers,
  ownerId: string,
): Promise<TransformMateSyncData> {
  return serializeOwner(ownerId, async () => {
    const contextValue = context(headers, ownerId);
    await contextValue.access('workouts:read');
    const engine = syncEngine({
      ...contextValue,
      client: getTransformMateClient(),
    });
    for (const link of contextValue.repository.list(ownerId))
      await engine.process(link);
    return listTransformMateSync(headers, ownerId);
  });
}
