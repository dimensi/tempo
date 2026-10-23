import 'server-only';
import { authorize } from '@/server/auth/guards';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { listWorkouts, WorkoutAccessError } from './index';
import { listTransformMateSync } from './transformmate/service';

export class SavedWorkoutRangeError extends Error {}
export async function requireOwnerWorkoutRead(
  headers: Headers,
  ownerId: string,
) {
  const access = await authorize(headers, 'workouts:read', ownerId);
  if (!access.ok || access.session.user.role !== 'OWNER')
    throw new WorkoutAccessError(access.ok ? 403 : access.status);
}
/** Saved provider projections only, including existing linked/native exclusions. */
export async function listSavedWorkouts(
  headers: Headers,
  ownerId: string,
  input: unknown,
) {
  await requireOwnerWorkoutRead(headers, ownerId);
  const range = analyticsRangeSchema.parse(input);
  const local = await listWorkouts(headers, ownerId);
  const remote = await listTransformMateSync(headers, ownerId, {
    ...range,
    limit: 50,
  });
  const native = [...remote.nativePage.items];
  let cursor = remote.nativePage.nextCursor;
  let pages = 1;
  while (cursor) {
    if (pages++ >= 40) throw new SavedWorkoutRangeError();
    const page = (
      await listTransformMateSync(headers, ownerId, {
        ...range,
        limit: 50,
        cursor,
      })
    ).nativePage;
    native.push(...page.items);
    cursor = page.nextCursor;
  }
  await requireOwnerWorkoutRead(headers, ownerId);
  // A local publication intent is not another saved provider workout.
  const linked = remote.items.filter((item) => item.remoteTrainingId !== null);
  return { local, linked, native };
}
