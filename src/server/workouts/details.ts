import 'server-only';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { getTransformMateBindingFence } from '@/server/transformmate/runtime';
import { nativeRepository } from './transformmate/native-repository';
import { syncRepository } from './transformmate/repository';
import { listTransformMateSync } from './transformmate/service';
import { listWorkouts, WorkoutAccessError } from './index';

/** Reading a view never refreshes the upstream or creates publication intent. */
export async function readWorkoutDetails(
  headers: Headers,
  ownerId: string,
  resource:
    | { kind: 'plan'; planId: string; workoutId: string }
    | { kind: 'session'; id: string }
    | { kind: 'native'; id: number }
    | { kind: 'link'; id: string },
  date: string,
) {
  const access = async () => {
    const result = await authorize(headers, 'workouts:read', ownerId);
    if (!result.ok) throw new WorkoutAccessError(result.status);
  };
  await access();
  if (resource.kind === 'native') {
    const binding = await getTransformMateBindingFence(ownerId);
    await binding.assertCurrent();
    await access();
    if (!binding.accountScope) return null;
    // A cached native snapshot may later become linked; keep detail reads consistent with lists.
    if (
      syncRepository(getDatabase().db)
        .list(ownerId)
        .some((link) => link.remoteTrainingId === resource.id)
    )
      return null;
    const item = nativeRepository(getDatabase().db).get(
      ownerId,
      binding.accountScope,
      resource.id,
    );
    binding.assertBindingCurrent();
    await access();
    return item ? { kind: 'native' as const, item } : null;
  }
  if (resource.kind === 'session') {
    const data = await listWorkouts(headers, ownerId);
    const session = data.sessions.find((item) => item.id === resource.id);
    return session ? { kind: 'session' as const, session } : null;
  }
  const sync = await listTransformMateSync(headers, ownerId, {
    from: z.iso.date().parse(date),
    to: date,
    limit: 20,
  });
  if (resource.kind === 'link') {
    const item = sync.items.find((item) => item.id === resource.id);
    return item ? { kind: 'link' as const, item } : null;
  }
  const data = await listWorkouts(headers, ownerId);
  const plan = data.plans.find((item) => item.id === resource.planId);
  const workout = plan?.workouts.find((item) => item.id === resource.workoutId);
  if (!plan || !workout) return null;
  return {
    kind: 'plan' as const,
    plan,
    workout,
    sync:
      sync.items.find(
        (item) => item.planId === plan.id && item.workoutId === workout.id,
      ) ?? null,
    sessions: data.sessions.filter(
      (item) => item.planId === plan.id && item.plannedWorkoutId === workout.id,
    ),
  };
}
