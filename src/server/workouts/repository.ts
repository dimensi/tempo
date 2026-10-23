import 'server-only';
import { and, eq, asc } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { getDatabase } from '@/server/db';
import { workouts } from '@/server/db/schema/workouts';
import { offlineWriteReceipts } from '@/server/db/schema/offline-writes';
import {
  exerciseFeedbackSchema,
  type ExerciseFeedback,
  workoutSchema,
  workoutInputSchema,
  type Workout,
  type WorkoutInput,
  type WorkoutAction,
  type WorkoutsData,
} from '@/contracts/workouts';
import { syncRepository } from './transformmate/repository';

export class WorkoutError extends Error {
  constructor(public status: 400 | 404 | 409) {
    super('Workout operation failed');
  }
}
export function workoutRepository(db: ReturnType<typeof getDatabase>['db']) {
  const scope = (ownerId: string, id: string) =>
    and(eq(workouts.ownerId, ownerId), eq(workouts.id, id));
  const dto = (row: typeof workouts.$inferSelect) =>
    workoutSchema.parse({
      ...row.data,
      id: row.id,
      ownerId: row.ownerId,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  const get = (ownerId: string, id: string) => {
    const row = db.select().from(workouts).where(scope(ownerId, id)).get();
    if (!row) throw new WorkoutError(404);
    return dto(row);
  };
  const assertRevision = (ownerId: string, id: string, revision: number) => {
    if (get(ownerId, id).revision !== revision) throw new WorkoutError(409);
  };
  function receipt(
    ownerId: string,
    requestId: string | undefined,
    input: unknown,
    save: () => Workout,
  ) {
    return db.transaction((tx) => {
      const operationId = 'workout:' + requestId;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
      if (requestId) {
        const previous = tx
          .select()
          .from(offlineWriteReceipts)
          .where(
            and(
              eq(offlineWriteReceipts.ownerId, ownerId),
              eq(offlineWriteReceipts.operationId, operationId),
            ),
          )
          .get();
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new WorkoutError(409);
          return workoutSchema.parse(JSON.parse(previous.result));
        }
      }
      const saved = save();
      if (requestId)
        tx.insert(offlineWriteReceipts)
          .values({
            ownerId,
            operationId,
            fingerprint,
            result: JSON.stringify(saved),
          })
          .run();
      return saved;
    });
  }
  function validateUpdate(
    ownerId: string,
    id: string,
    revision: number,
    data: WorkoutInput,
    action?: WorkoutAction,
  ) {
    if (
      data.status === 'planned' &&
      data.exercises.some((e) => e.fatigue != null || e.failure != null)
    )
      throw new WorkoutError(400);
    const existing = get(ownerId, id);
    assertRevision(ownerId, id, revision);
    const expected =
      action === 'start'
        ? ['planned', 'in_progress']
        : action === 'complete'
          ? ['in_progress', 'completed']
          : action === 'resume'
            ? ['completed', 'in_progress']
            : [existing.status, existing.status];
    if (
      existing.status !== expected[0] ||
      data.status !== expected[1] ||
      (!action && existing.status === 'completed')
    )
      throw new WorkoutError(409);
    if (
      (action === 'start' || action === 'complete') &&
      (!data.exercises.length || data.exercises.some((e) => !e.sets.length))
    )
      throw new WorkoutError(400);
    // Resume changes only lifecycle state; completed values remain intact.
    if (
      action === 'resume' &&
      JSON.stringify(
        workoutInputSchema.parse({ ...data, status: existing.status }),
      ) !==
        JSON.stringify(
          workoutInputSchema.parse({
            date: existing.date,
            title: existing.title,
            exercises: existing.exercises,
            note: existing.note,
            status: existing.status,
          }),
        )
    )
      throw new WorkoutError(409);
    if (data.exercises.some((e) => !e.id)) throw new WorkoutError(409);
  }
  function replayUpdate(
    ownerId: string,
    id: string,
    revision: number,
    data: WorkoutInput,
    action?: WorkoutAction,
    requestId?: string,
  ): Workout | null {
    if (!requestId) return null;
    const previous = db
      .select()
      .from(offlineWriteReceipts)
      .where(
        and(
          eq(offlineWriteReceipts.ownerId, ownerId),
          eq(offlineWriteReceipts.operationId, 'workout:' + requestId),
        ),
      )
      .get();
    if (!previous) return null;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ kind: 'update', id, revision, data, action }))
      .digest('hex');
    if (previous.fingerprint !== fingerprint) throw new WorkoutError(409);
    return workoutSchema.parse(JSON.parse(previous.result));
  }
  return {
    get,
    updateFeedback(
      ownerId: string,
      id: string,
      revision: number,
      input: ExerciseFeedback,
      requestId?: string,
    ) {
      const feedback = exerciseFeedbackSchema.parse(input);
      return receipt(
        ownerId,
        requestId,
        { kind: 'feedback', id, revision, feedback },
        () => {
          const existing = get(ownerId, id);
          assertRevision(ownerId, id, revision);
          if (existing.status === 'planned') throw new WorkoutError(409);
          if (
            !existing.exercises.some(
              (exercise) => exercise.id === feedback.exerciseId,
            )
          )
            throw new WorkoutError(404);
          const data = {
            ...workoutInputSchema.parse({
              date: existing.date,
              title: existing.title,
              note: existing.note,
              status: existing.status,
              exercises: existing.exercises,
            }),
            ...(existing.legacySource
              ? { legacySource: existing.legacySource }
              : {}),
          };
          const row = db
            .update(workouts)
            .set({
              data: {
                ...data,
                exercises: data.exercises.map((exercise) =>
                  exercise.id === feedback.exerciseId
                    ? {
                        ...exercise,
                        fatigue: feedback.fatigue,
                        failure: feedback.failure,
                      }
                    : exercise,
                ),
              },
              revision: revision + 1,
              updatedAt: new Date().toISOString(),
            })
            .where(and(scope(ownerId, id), eq(workouts.revision, revision)))
            .returning()
            .get();
          if (!row) throw new WorkoutError(409);
          // Feedback is local execution data: never reconcile or publish the provider plan.
          return dto(row);
        },
      );
    },
    assertRevision,
    validateUpdate,
    replayUpdate,
    list(ownerId: string): WorkoutsData {
      return {
        contractVersion: 2,
        source: 'user',
        workouts: db
          .select()
          .from(workouts)
          .where(eq(workouts.ownerId, ownerId))
          .orderBy(asc(workouts.date), asc(workouts.createdAt))
          .all()
          .map(dto),
      };
    },
    create(ownerId: string, input: WorkoutInput, requestId?: string) {
      const data = workoutInputSchema.parse(input);
      return receipt(ownerId, requestId, { kind: 'create', data }, () => {
        if (data.status !== 'planned') throw new WorkoutError(409);
        if (data.exercises.some((e) => e.fatigue != null || e.failure != null))
          throw new WorkoutError(400);
        const now = new Date().toISOString();
        const saved = dto(
          db
            .insert(workouts)
            .values({
              id: requestId ?? randomUUID(),
              ownerId,
              date: data.date,
              data: {
                ...data,
                exercises: data.exercises.map((e) => ({
                  ...e,
                  id: e.id ?? randomUUID(),
                })),
              },
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );
        syncRepository(db).ensure(ownerId, saved);
        return saved;
      });
    },
    update(
      ownerId: string,
      id: string,
      revision: number,
      input: WorkoutInput,
      action?: WorkoutAction,
      requestId?: string,
    ) {
      const data = workoutInputSchema.parse(input);
      return receipt(
        ownerId,
        requestId,
        { kind: 'update', id, revision, data, action },
        () => {
          validateUpdate(ownerId, id, revision, data, action);
          const saved = dto(
            db
              .update(workouts)
              .set({
                data: {
                  ...data,
                  ...(get(ownerId, id).legacySource
                    ? { legacySource: get(ownerId, id).legacySource }
                    : {}),
                },
                date: data.date,
                revision: revision + 1,
                updatedAt: new Date().toISOString(),
              })
              .where(and(scope(ownerId, id), eq(workouts.revision, revision)))
              .returning()
              .get(),
          );
          syncRepository(db).ensure(ownerId, saved);
          return saved;
        },
      );
    },
    delete(ownerId: string, id: string, revision: number) {
      db.transaction(() => {
        assertRevision(ownerId, id, revision);
        db.delete(workouts)
          .where(and(scope(ownerId, id), eq(workouts.revision, revision)))
          .run();
      });
    },
  };
}
