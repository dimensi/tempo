import 'server-only';
import { z } from 'zod';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import {
  exerciseFeedbackSchema,
  workoutInputSchema,
  workoutActionSchema,
  revisionSchema,
  type WorkoutAction,
} from '@/contracts/workouts';
import { workoutRepository, WorkoutError } from './repository';
import { saveAndSyncWorkout } from './transformmate/service';
import { serializeOwner } from './transformmate/engine';
export class WorkoutAccessError extends Error {
  constructor(public status: number) {
    super('Workout access denied');
  }
}
const idSchema = z.string().min(1).max(128);
async function access(
  headers: Headers,
  ownerId: string,
  permission: Parameters<typeof authorize>[1],
) {
  const result = await authorize(headers, permission, idSchema.parse(ownerId));
  if (!result.ok) throw new WorkoutAccessError(result.status);
  return {
    repository: workoutRepository(getDatabase().db),
  };
}
export async function listWorkouts(headers: Headers, ownerId: string) {
  return (await access(headers, ownerId, 'workouts:read')).repository.list(
    ownerId,
  );
}
export async function createWorkout(
  headers: Headers,
  ownerId: string,
  input: unknown,
  requestId?: string,
) {
  const { repository } = await access(headers, ownerId, 'workouts:plan');
  const data = workoutInputSchema.parse(input);
  const key = requestId === undefined ? undefined : z.uuid().parse(requestId);
  return saveAndSyncWorkout(headers, ownerId, () =>
    repository.create(ownerId, data, key),
  );
}
export async function updateWorkout(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
  input: unknown,
  action?: WorkoutAction,
  requestId?: string,
) {
  const { repository } = await access(
    headers,
    ownerId,
    action ? 'workouts:log' : 'workouts:plan',
  );
  idSchema.parse(id);
  const expected = revisionSchema.parse(revision);
  const data = workoutInputSchema.parse(input);
  const transition =
    action === undefined ? undefined : workoutActionSchema.parse(action);
  const key = requestId === undefined ? undefined : z.uuid().parse(requestId);
  const { sessionVideoRows, cleanupVideoRows, withSessionVideoLock } =
    await import('./videos');
  return withSessionVideoLock(ownerId, id, async () => {
    return saveAndSyncWorkout(headers, ownerId, async () => {
      const replay = repository.replayUpdate(
        ownerId,
        id,
        expected,
        data,
        transition,
        key,
      );
      if (replay) return replay;
      repository.validateUpdate(ownerId, id, expected, data, transition);
      await cleanupVideoRows(
        sessionVideoRows(ownerId, id).filter(
          (row) =>
            !data.exercises.some((exercise) => exercise.id === row.exerciseId),
        ),
      );
      return repository.update(ownerId, id, expected, data, transition, key);
    });
  });
}
export async function updateExerciseFeedback(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
  input: unknown,
  requestId: unknown,
) {
  const { repository } = await access(headers, ownerId, 'workouts:log');
  return repository.updateFeedback(
    ownerId,
    idSchema.parse(id),
    revisionSchema.parse(revision),
    exerciseFeedbackSchema.parse(input),
    z.uuid().parse(requestId),
  );
}
export async function deleteWorkout(
  headers: Headers,
  ownerId: string,
  id: string,
  revision: unknown,
) {
  const { repository } = await access(headers, ownerId, 'workouts:plan');
  idSchema.parse(id);
  const expected = revisionSchema.parse(revision);
  const { sessionVideoRows, cleanupVideoRows, withSessionVideoLock } =
    await import('./videos');
  return withSessionVideoLock(ownerId, id, () =>
    serializeOwner(ownerId, async () => {
      repository.assertRevision(ownerId, id, expected);
      await cleanupVideoRows(sessionVideoRows(ownerId, id));
      repository.delete(ownerId, id, expected);
    }),
  );
}
export { WorkoutError };
