import 'server-only';
import { and, eq, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { getDatabase } from '@/server/db';
import { publicationWorkoutSchema } from '@/contracts/workout-publication';
import { workoutTransformMateLinks as links } from '@/server/db/schema/transformmate';
import { syncStateSchema, type SyncLink, type SyncState } from './state';
import type { Workout } from '@/contracts/workouts';
import { canPublish, publicationFor } from './publication';
import { projectionFingerprint } from './mapping';

export function syncRepository(
  db: Pick<
    ReturnType<typeof getDatabase>['db'],
    'select' | 'insert' | 'update'
  >,
) {
  const encode = (state: SyncState) => {
    const json = JSON.stringify(syncStateSchema.parse(state));
    if (Buffer.byteLength(json, 'utf8') > 8 * 1024 * 1024)
      throw new Error('Invalid sync state');
    return json;
  };
  const validateLink = (link: SyncLink) => {
    z.uuid().parse(link.id);
    z.number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(link.revision);
    z.number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .parse(link.remoteTrainingId);
    if (link.state.marker !== `[yazio-dashboard:${link.id}]`)
      throw new Error('Invalid sync state');
  };
  const dto = (row: typeof links.$inferSelect): SyncLink => {
    if (Buffer.byteLength(row.state, 'utf8') > 8 * 1024 * 1024)
      throw new Error('Invalid sync state');
    const link = {
      ...row,
      state: syncStateSchema.parse(JSON.parse(row.state)),
    };
    validateLink(link);
    return link;
  };
  const repository = {
    list(ownerId: string) {
      return db
        .select()
        .from(links)
        .where(eq(links.ownerId, ownerId))
        .orderBy(asc(links.createdAt))
        .all()
        .map(dto);
    },
    reconcile(link: SyncLink, saved: Workout): SyncLink | null {
      if (saved.ownerId !== link.ownerId || saved.id !== link.planId)
        return null;
      if (!canPublish(saved)) return link;
      const plan = publicationFor(saved);
      if (link.state.attempted || link.remoteTrainingId !== null) {
        const published = link.state.published;
        const current = plan.workouts.find((w) => w.id === link.workoutId);
        if (
          !published ||
          !current ||
          !link.state.baseline ||
          link.remoteTrainingId === null ||
          link.state.updateAttempt?.phase === 'unknown'
        )
          return link;
        const workout = publicationWorkoutSchema.parse(current);
        if (JSON.stringify(workout) === JSON.stringify(published.workout)) {
          if (link.state.updateAttempt?.phase === 'pending')
            return repository.cas(link, {
              ...link.state,
              status: 'synced',
              reason: null,
              published: { ...published, planTitle: plan.title },
              updateAttempt: {
                ...link.state.updateAttempt,
                phase: 'conflict',
                checkedAt: new Date().toISOString(),
              },
            });
          if (published.planTitle !== plan.title)
            return repository.cas(link, {
              ...link.state,
              published: { ...published, planTitle: plan.title },
            });
          return link;
        }
        const prior = link.state.updateAttempt;
        if (
          prior &&
          JSON.stringify(prior.desired.workout) === JSON.stringify(workout)
        )
          return link;
        return repository.cas(link, {
          ...link.state,
          status: 'pending',
          reason: null,
          updateAttempt: {
            id: randomUUID(),
            phase: 'pending',
            previous: {
              workout: published.workout,
              planTitle: published.planTitle,
            },
            desired: { workout, planTitle: plan.title },
            previousFingerprint: projectionFingerprint(link.state.baseline),
            expectedFingerprint: null,
            connectionId: null,
            createdAt: new Date().toISOString(),
            checkedAt: null,
          },
        });
      }
      const current = plan.workouts.find((w) => w.id === link.workoutId);
      if (!current) return null;
      const workout = publicationWorkoutSchema.parse(current);
      if (
        JSON.stringify(workout) === JSON.stringify(link.state.workout) &&
        plan.title === link.state.planTitle
      )
        return link;
      const supported =
        workout.exercises.every((e) => e.transformMate) &&
        new Set(workout.exercises.map((e) => e.transformMate?.occurrenceKey))
          .size === workout.exercises.length;
      return repository.cas(link, {
        ...link.state,
        workout,
        planTitle: plan.title,
        status: supported ? 'pending' : 'unavailable',
        reason: supported ? null : 'unsupported',
        expected: null,
        baseline: null,
        occurrences: [],
        actual: null,
        checkedAt: null,
      });
    },
    ensure(ownerId: string, saved: Workout) {
      if (saved.ownerId !== ownerId) throw new Error('Invalid workout owner');
      if (!canPublish(saved)) return;
      const plan = publicationFor(saved);
      for (const workout of plan.workouts) {
        const existing = db
          .select()
          .from(links)
          .where(
            and(
              eq(links.ownerId, ownerId),
              eq(links.planId, plan.id),
              eq(links.workoutId, workout.id),
            ),
          )
          .get();
        if (existing) {
          repository.reconcile(dto(existing), saved);
          continue;
        }
        if (!workout.exercises.some((e) => e.transformMate)) continue;
        const id = randomUUID();
        const now = new Date().toISOString();
        const supported =
          workout.exercises.every((e) => e.transformMate) &&
          new Set(workout.exercises.map((e) => e.transformMate?.occurrenceKey))
            .size === workout.exercises.length;
        const state: SyncState = {
          version: 1,
          workout,
          planTitle: plan.title,
          marker: `[yazio-dashboard:${id}]`,
          attempted: false,
          status: supported ? 'pending' : 'unavailable',
          reason: supported ? null : 'unsupported',
          expected: null,
          baseline: null,
          occurrences: [],
          checkedAt: null,
          actual: null,
        };
        db.insert(links)
          .values({
            id,
            ownerId,
            planId: plan.id,
            workoutId: workout.id,
            state: encode(state),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    },
    cas(
      link: SyncLink,
      state: SyncState,
      remoteTrainingId = link.remoteTrainingId,
    ): SyncLink | null {
      validateLink(link);
      if (link.revision === Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid sync revision');
      z.number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .nullable()
        .parse(remoteTrainingId);
      const row = db
        .update(links)
        .set({
          state: encode(state),
          remoteTrainingId,
          revision: link.revision + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(links.ownerId, link.ownerId),
            eq(links.id, link.id),
            eq(links.revision, link.revision),
          ),
        )
        .returning()
        .get();
      return row ? dto(row) : null;
    },
  };
  return repository;
}
export type SyncRepository = ReturnType<typeof syncRepository>;
