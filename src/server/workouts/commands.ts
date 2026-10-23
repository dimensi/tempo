import 'server-only';
import { randomUUID } from 'node:crypto';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { withWriteReceipt } from '@/server/write-receipts';
import {
  workoutInputSchema,
  workoutExerciseSchema,
  type WorkoutInput,
  type Workout,
} from '@/contracts/workouts';
import type { WorkoutCommand } from '@/contracts/mcp-writes';
import { workoutRepository, WorkoutError } from './repository';
import { WorkoutAccessError } from './index';
import { serializeOwner } from './transformmate/engine';
import { syncSavedWorkout } from './transformmate/service';
import { syncRepository } from './transformmate/repository';
import { withSessionVideoLock } from './videos';

const dataOf = (w: Workout): WorkoutInput =>
  workoutInputSchema.parse({
    date: w.date,
    title: w.title,
    note: w.note,
    status: w.status,
    exercises: w.exercises,
  });
/** Additive exercise patches retain identities, attached videos and unspecified results. */
export async function executeWorkoutCommand(
  headers: Headers,
  ownerId: string,
  namespace: string,
  command: WorkoutCommand,
) {
  const checkAccess = async () => {
    for (const permission of ['workouts:plan', 'workouts:log'] as const) {
      const access = await authorize(headers, permission, ownerId);
      if (!access.ok || access.session.user.role !== 'OWNER')
        throw new WorkoutAccessError(access.ok ? 403 : access.status);
    }
  };
  await checkAccess();
  const repo = workoutRepository(getDatabase().db);
  const save = () =>
    serializeOwner(ownerId, async () => {
      await checkAccess();
      return withWriteReceipt(
        ownerId,
        namespace,
        command.input.requestId,
        command,
        () => {
          let saved: Workout;
          if (command.kind === 'create') {
            const data = workoutInputSchema.parse(command.input.data);
            if (
              data.status === 'planned' &&
              data.exercises.some((e) => e.fatigue != null || e.failure != null)
            )
              throw new WorkoutError(400);
            // The entire lifecycle is invisible until commit; no intermediate provider HTTP.
            saved = repo.create(ownerId, {
              ...data,
              status: 'planned',
              exercises: data.exercises.map((e) => ({
                id: e.id,
                name: e.name,
                comment: e.comment,
                sets: e.sets,
                transformMate: e.transformMate,
              })),
            });
            if (data.status === 'completed') {
              const actual = {
                ...data,
                exercises: data.exercises.map((e, i) => ({
                  ...e,
                  id: saved.exercises[i]!.id,
                })),
              };
              saved = repo.update(
                ownerId,
                saved.id,
                saved.revision,
                { ...actual, status: 'in_progress' },
                'start',
              );
              saved = repo.update(
                ownerId,
                saved.id,
                saved.revision,
                actual,
                'complete',
              );
              // These transitions describe import, not observed historical execution times.
              syncRepository(getDatabase().db).markHistoricalTimeUnknown(
                ownerId,
                saved.id,
              );
            }
          } else {
            const { id, revision } = command.input;
            const current = repo.get(ownerId, id);
            if (command.kind === 'feedback') {
              saved = repo.updateFeedback(
                ownerId,
                id,
                revision,
                command.input.feedback,
              );
            } else if (command.kind === 'transition') {
              const action = command.input.action;
              const status =
                action === 'complete' ? 'completed' : 'in_progress';
              saved = repo.update(
                ownerId,
                id,
                revision,
                { ...dataOf(current), status },
                action,
              );
            } else {
              const { exercises, ...patch } = command.input.patch;
              const next = current.exercises.map((e) => ({ ...e }));
              const seen = new Set<string>();
              for (const exercise of exercises ?? []) {
                if (exercise.id && seen.has(exercise.id))
                  throw new WorkoutError(400);
                const index = exercise.id
                  ? next.findIndex((e) => e.id === exercise.id)
                  : -1;
                if (exercise.id && index < 0) throw new WorkoutError(404);
                if (exercise.id) seen.add(exercise.id);
                if (index >= 0) next[index] = { ...next[index]!, ...exercise };
                else
                  next.push(
                    workoutExerciseSchema.parse({
                      ...exercise,
                      id: randomUUID(),
                    }),
                  );
              }
              saved = repo.update(
                ownerId,
                id,
                revision,
                workoutInputSchema.parse({
                  ...dataOf(current),
                  ...patch,
                  exercises: next,
                }),
              );
            }
          }
          return {
            workout: saved,
            sync: syncRepository(getDatabase().db)
              .list(ownerId)
              .filter((link) => link.workoutId === saved.id)
              .map((link) => ({
                status: link.state.status,
                reason: link.state.reason,
                checkedAt: link.state.checkedAt,
              })),
          };
        },
      );
    });
  const result =
    command.kind === 'create'
      ? await save()
      : await withSessionVideoLock(ownerId, command.input.id, save);
  // Feedback is purely local. Provider failure must not roll back a committed workout.
  if (command.kind !== 'feedback')
    await syncSavedWorkout(headers, ownerId, result.workout).catch(() => {});
  return result;
}
