import 'server-only';
import { and, eq, asc } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { getDatabase } from '@/server/db';
import { workoutPlans, workoutSessions } from '@/server/db/schema/workouts';
import {
  workoutPlanSchema,
  workoutSessionSchema,
  type WorkoutPlanInput,
  type WorkoutSessionCreate,
  type WorkoutSessionInput,
  type WorkoutsData,
} from '@/contracts/workouts';
import { syncRepository } from './transformmate/repository';

export class WorkoutError extends Error {
  constructor(public status: 404 | 409) {
    super('Workout operation failed');
  }
}

// Internal persistence API. Public callers go through authorized service functions.
export function workoutRepository(db: ReturnType<typeof getDatabase>['db']) {
  const planScope = (ownerId: string, id: string) =>
    and(eq(workoutPlans.ownerId, ownerId), eq(workoutPlans.id, id));
  const sessionScope = (ownerId: string, id: string) =>
    and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.id, id));
  const planDto = (row: typeof workoutPlans.$inferSelect) =>
    workoutPlanSchema.parse({
      ...row.data,
      id: row.id,
      ownerId: row.ownerId,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  const sessionDto = (row: typeof workoutSessions.$inferSelect) =>
    workoutSessionSchema.parse({
      ...row.data,
      id: row.id,
      ownerId: row.ownerId,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  return {
    list(ownerId: string): WorkoutsData {
      return {
        contractVersion: 1,
        source: 'user',
        plans: db
          .select()
          .from(workoutPlans)
          .where(eq(workoutPlans.ownerId, ownerId))
          .orderBy(asc(workoutPlans.createdAt))
          .all()
          .map(planDto),
        sessions: db
          .select()
          .from(workoutSessions)
          .where(eq(workoutSessions.ownerId, ownerId))
          .orderBy(asc(workoutSessions.date))
          .all()
          .map(sessionDto),
      };
    },
    createPlan(ownerId: string, data: WorkoutPlanInput, requestId?: string) {
      return db.transaction((tx) => {
        if (requestId) {
          const existing = tx
            .select()
            .from(workoutPlans)
            .where(eq(workoutPlans.id, requestId))
            .get();
          if (existing) {
            if (
              existing.ownerId !== ownerId ||
              createHash('sha256')
                .update(JSON.stringify(existing.data))
                .digest('hex') !==
                createHash('sha256').update(JSON.stringify(data)).digest('hex')
            )
              throw new WorkoutError(409);
            return planDto(existing);
          }
        }
        const now = new Date().toISOString();
        const saved = planDto(
          tx
            .insert(workoutPlans)
            .values({
              id: requestId ?? randomUUID(),
              ownerId,
              data,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );
        // Commit the publication intent with the plan; restart can recover without another save.
        syncRepository(tx).ensure(ownerId, saved);
        return saved;
      });
    },
    updatePlan(
      ownerId: string,
      id: string,
      revision: number,
      data: WorkoutPlanInput,
    ) {
      return db.transaction((tx) => {
        const row = tx
          .update(workoutPlans)
          .set({
            data,
            revision: revision + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(planScope(ownerId, id), eq(workoutPlans.revision, revision)),
          )
          .returning()
          .get();
        if (!row)
          throw new WorkoutError(
            tx
              .select({ id: workoutPlans.id })
              .from(workoutPlans)
              .where(planScope(ownerId, id))
              .get()
              ? 409
              : 404,
          );
        const saved = planDto(row);
        syncRepository(tx).ensure(ownerId, saved);
        return saved;
      });
    },
    deletePlan(ownerId: string, id: string, revision: number) {
      const result = db
        .delete(workoutPlans)
        .where(and(planScope(ownerId, id), eq(workoutPlans.revision, revision)))
        .run();
      if (!result.changes)
        throw new WorkoutError(
          db
            .select({ id: workoutPlans.id })
            .from(workoutPlans)
            .where(planScope(ownerId, id))
            .get()
            ? 409
            : 404,
        );
    },
    createSession(ownerId: string, input: WorkoutSessionCreate) {
      return db.transaction((tx) => {
        const { planId, plannedWorkoutId, ...actual } = input;
        actual.exercises = actual.exercises.map((exercise) => ({
          ...exercise,
          id: exercise.id ?? randomUUID(),
        }));
        let planSnapshot: (typeof workoutSessions.$inferSelect)['data']['planSnapshot'] =
          null;
        if (planId && plannedWorkoutId) {
          const plan = tx
            .select()
            .from(workoutPlans)
            .where(planScope(ownerId, planId))
            .get();
          const workout = plan?.data.workouts.find(
            (value) => value.id === plannedWorkoutId,
          );
          if (!plan || !workout) throw new WorkoutError(404);
          planSnapshot = { planTitle: plan.data.title, workout };
        }
        const now = new Date().toISOString();
        return sessionDto(
          tx
            .insert(workoutSessions)
            .values({
              id: randomUUID(),
              ownerId,
              date: actual.date,
              data: {
                ...actual,
                planId: planId ?? null,
                plannedWorkoutId: plannedWorkoutId ?? null,
                planSnapshot,
              },
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );
      });
    },
    updateSession(
      ownerId: string,
      id: string,
      revision: number,
      input: WorkoutSessionInput,
    ) {
      return db.transaction((tx) => {
        const existing = tx
          .select()
          .from(workoutSessions)
          .where(sessionScope(ownerId, id))
          .get();
        if (!existing) throw new WorkoutError(404);
        if (existing.revision !== revision) throw new WorkoutError(409);
        // A missing occurrence ID cannot be matched safely by name or array position.
        if (input.exercises.some((exercise) => !exercise.id))
          throw new WorkoutError(409);
        return sessionDto(
          tx
            .update(workoutSessions)
            .set({
              data: {
                ...existing.data,
                ...input,
                exercises: input.exercises,
              },
              date: input.date,
              revision: revision + 1,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                sessionScope(ownerId, id),
                eq(workoutSessions.revision, revision),
              ),
            )
            .returning()
            .get(),
        );
      });
    },
    deleteSession(ownerId: string, id: string, revision: number) {
      const result = db
        .delete(workoutSessions)
        .where(
          and(
            sessionScope(ownerId, id),
            eq(workoutSessions.revision, revision),
          ),
        )
        .run();
      if (!result.changes)
        throw new WorkoutError(
          db
            .select({ id: workoutSessions.id })
            .from(workoutSessions)
            .where(sessionScope(ownerId, id))
            .get()
            ? 409
            : 404,
        );
    },
  };
}
