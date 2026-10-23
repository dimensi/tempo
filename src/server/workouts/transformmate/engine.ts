import 'server-only';
import {
  publicationWorkoutSchema,
  type PublicationWorkout,
} from '@/contracts/workout-publication';
import type { Workout } from '@/contracts/workouts';
import { canPublish, publicationFor } from './publication';
import { TransformMateApiError } from '@/server/transformmate/errors';
import type { TransformMateClient } from '@/server/transformmate/client';
import type { SyncRepository } from './repository';
import type { SyncLink } from './state';
import {
  actualProjection,
  canProject,
  createProjection,
  expectedProjection,
  initialPlaceholders,
  remoteExercises,
  remoteProjection,
  validateRemoteOrder,
  hasRemoteFact,
  projectionFingerprint,
  updateProjection,
} from './mapping';

export interface SyncEngineOptions {
  repository: SyncRepository;
  client:
    | (Pick<
        TransformMateClient,
        'getExercise' | 'createTraining' | 'listTrainings' | 'getTraining'
      > &
        Partial<Pick<TransformMateClient, 'updateTrainingOnce'>>)
    | null;
  // Must throw on revocation. Called before and after each HTTP await and before local writes.
  access: (permission: 'workouts:read' | 'workouts:plan') => Promise<void>;
  workouts: () => Workout[];
  checkConnection?: () => Promise<void>;
  connectionId?: string;
}
const queues = new Map<string, Promise<unknown>>();
export async function serializeOwner<T>(
  ownerId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(ownerId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(ownerId, next);
  try {
    return await next;
  } finally {
    if (queues.get(ownerId) === next) queues.delete(ownerId);
  }
}
export function syncEngine(options: SyncEngineOptions) {
  const { repository, client, workouts } = options;
  const access = async (permission: 'workouts:read' | 'workouts:plan') => {
    await options.access(permission);
    if (options.checkConnection) {
      await options.checkConnection();
      await options.access(permission);
    }
  };
  const currentPlan = (link: SyncLink) =>
    workouts().find((p) => p.id === link.planId && p.ownerId === link.ownerId);
  const currentWorkout = (link: SyncLink): PublicationWorkout | undefined => {
    const local = currentPlan(link);
    return local && canPublish(local)
      ? publicationFor(local).workouts.find((w) => w.id === link.workoutId)
      : undefined;
  };
  const changed = (link: SyncLink) => {
    const current = currentWorkout(link);
    return (
      current &&
      JSON.stringify(publicationWorkoutSchema.parse(current)) !==
        JSON.stringify(link.state.published?.workout ?? link.state.workout)
    );
  };
  async function save(
    link: SyncLink,
    patch: Partial<SyncLink['state']>,
    remoteId = link.remoteTrainingId,
  ) {
    await access('workouts:read');
    return repository.cas(link, { ...link.state, ...patch }, remoteId);
  }
  async function http<T>(
    read: () => Promise<T>,
    permission: 'workouts:read' | 'workouts:plan' = 'workouts:read',
  ) {
    await access(permission);
    try {
      const result = await read();
      await access(permission);
      return result;
    } catch (error) {
      await access(permission);
      throw error;
    }
  }
  async function verify(link: SyncLink) {
    if (!client) return;
    try {
      if (link.remoteTrainingId === null) {
        const { body } = await http(() => client.listTrainings());
        const candidates = body.filter(
          (t) => t.description === link.state.marker,
        );
        if (candidates.length !== 1) {
          await save(link, {
            status: candidates.length > 1 ? 'conflict' : 'unknown',
            reason: 'ambiguous_write',
          });
          return;
        }
        const next = await save(link, {}, candidates[0]!.id);
        if (!next) return;
        link = next;
      }
      const id = link.remoteTrainingId!;
      const { body } = await http(() => client.getTraining(id));
      validateRemoteOrder(body);
      const projection = remoteProjection(body);
      const fingerprint = projectionFingerprint(projection);
      const owned =
        body.id === id &&
        body.is_mine &&
        body.description === link.state.marker &&
        (!link.state.published ||
          body.author === link.state.published.authorId);
      if (!owned) {
        await save(link, { status: 'conflict', reason: 'remote_changed' });
        return;
      }
      const started =
        body.started !== null ||
        body.finished !== null ||
        body.progress !== 'idle';
      const fact = hasRemoteFact(body);
      const active = started || fact;
      const unsupported =
        link.state.updateAttempt?.phase === 'conflict' &&
        link.state.reason === 'unsupported';
      const attempt = link.state.updateAttempt;
      if (attempt?.phase === 'unknown') {
        if (fingerprint === attempt.expectedFingerprint) {
          const published = { ...attempt.desired, authorId: body.author };
          const updated = { ...link.state, published };
          const actual = actualProjection(body, updated, true);
          const needsNewer =
            currentWorkout(link) &&
            JSON.stringify(
              publicationWorkoutSchema.parse(currentWorkout(link)),
            ) !== JSON.stringify(published.workout);
          await save(link, {
            published,
            baseline: projection,
            expected: null,
            actual,
            checkedAt: new Date().toISOString(),
            status: started
              ? 'started'
              : fact || needsNewer
                ? 'conflict'
                : 'synced',
            reason: active
              ? started
                ? 'remote_started'
                : 'remote_fact'
              : needsNewer
                ? 'plan_changed'
                : null,
            updateAttempt: {
              ...attempt,
              phase: 'verified',
              checkedAt: new Date().toISOString(),
            },
            occurrences: remoteExercises(body).map((e, i) => ({
              remoteId: e.id,
              key: published.workout.exercises[i]!.transformMate!.occurrenceKey,
            })),
          });
          return;
        }
        const matched = fingerprint === attempt.previousFingerprint;
        await save(link, {
          status: matched ? 'unknown' : 'conflict',
          reason: matched ? 'ambiguous_write' : 'remote_changed',
          actual: actualProjection(body, link.state, matched),
          checkedAt: new Date().toISOString(),
          updateAttempt: matched
            ? { ...attempt, checkedAt: new Date().toISOString() }
            : {
                ...attempt,
                phase: 'conflict',
                checkedAt: new Date().toISOString(),
              },
        });
        return;
      }
      const matched =
        projection === (link.state.baseline ?? link.state.expected);
      const published = link.state.published ?? {
        workout: link.state.workout,
        planTitle: link.state.planTitle,
        authorId: body.author,
      };
      const valid =
        matched &&
        (link.state.baseline !== null ||
          active ||
          initialPlaceholders(body, published.workout));
      const actual = actualProjection(
        body,
        { ...link.state, published },
        matched,
      );
      await save(link, {
        actual,
        checkedAt: new Date().toISOString(),
        baseline: valid ? projection : link.state.baseline,
        expected: valid ? null : link.state.expected,
        published: valid ? published : link.state.published,
        status: started
          ? 'started'
          : fact
            ? 'conflict'
            : !valid
              ? 'conflict'
              : unsupported
                ? 'unavailable'
                : changed(link)
                  ? 'conflict'
                  : 'synced',
        reason: active
          ? started
            ? 'remote_started'
            : 'remote_fact'
          : !valid
            ? 'remote_changed'
            : unsupported
              ? 'unsupported'
              : changed(link)
                ? 'plan_changed'
                : null,
        occurrences: valid
          ? remoteExercises(body).map((e, i) => ({
              remoteId: e.id,
              key: published.workout.exercises[i]!.transformMate!.occurrenceKey,
            }))
          : link.state.occurrences,
      });
    } catch (error) {
      await access('workouts:read');
      await save(link, {
        status:
          link.state.updateAttempt?.phase === 'unknown' ||
          link.state.baseline === null
            ? 'unknown'
            : 'error',
        reason:
          link.state.updateAttempt?.phase === 'unknown' ||
          link.state.baseline === null
            ? 'ambiguous_write'
            : error instanceof TransformMateApiError && error.status === 404
              ? 'missing_remote'
              : 'upstream_error',
      });
    }
  }
  async function update(link: SyncLink) {
    if (
      !client ||
      !client.updateTrainingOnce ||
      !link.state.published ||
      !link.state.updateAttempt ||
      link.remoteTrainingId === null
    )
      return;
    const attempt = link.state.updateAttempt;
    if (attempt.phase !== 'pending') return;
    await access('workouts:plan');
    if (!currentWorkout(link)) return;
    const desired = attempt.desired.workout;
    if (
      !desired.exercises.every((e) => e.transformMate) ||
      new Set(desired.exercises.map((e) => e.transformMate?.occurrenceKey))
        .size !== desired.exercises.length
    ) {
      await save(link, {
        status: 'unavailable',
        reason: 'unsupported',
        updateAttempt: {
          ...attempt,
          phase: 'conflict',
          checkedAt: new Date().toISOString(),
        },
      });
      return;
    }
    let prepared: ReturnType<typeof updateProjection>;
    try {
      for (const exercise of desired.exercises) {
        const { body } = await http(() =>
          client.getExercise(exercise.transformMate!.exerciseId),
        );
        if (
          body.id !== exercise.transformMate!.exerciseId ||
          !canProject(
            body,
            exercise.sets.some((s) => s.weightKg !== null),
          )
        ) {
          await save(link, {
            status: 'unavailable',
            reason: 'unsupported',
            updateAttempt: {
              ...attempt,
              phase: 'conflict',
              checkedAt: new Date().toISOString(),
            },
          });
          return;
        }
      }
      const { body } = await http(() =>
        client.getTraining(link.remoteTrainingId!),
      );
      validateRemoteOrder(body);
      if (
        body.id !== link.remoteTrainingId ||
        !body.is_mine ||
        body.description !== link.state.marker ||
        body.author !== link.state.published.authorId ||
        projectionFingerprint(remoteProjection(body)) !==
          attempt.previousFingerprint
      ) {
        await save(link, {
          status: 'conflict',
          reason: 'remote_changed',
          updateAttempt: {
            ...attempt,
            phase: 'conflict',
            checkedAt: new Date().toISOString(),
          },
        });
        return;
      }
      const started =
        body.started !== null ||
        body.finished !== null ||
        body.progress !== 'idle';
      if (started || hasRemoteFact(body)) {
        await save(link, {
          status: started ? 'started' : 'conflict',
          reason: started ? 'remote_started' : 'remote_fact',
          actual: actualProjection(body, link.state, true),
          checkedAt: new Date().toISOString(),
          updateAttempt: {
            ...attempt,
            phase: 'conflict',
            checkedAt: new Date().toISOString(),
          },
        });
        return;
      }
      prepared = updateProjection(body, attempt.previous.workout, desired);
    } catch {
      await access('workouts:plan');
      await save(link, { status: 'error', reason: 'upstream_error' });
      return;
    }
    await access('workouts:plan');
    if (
      !currentWorkout(link) ||
      JSON.stringify(publicationWorkoutSchema.parse(currentWorkout(link))) !==
        JSON.stringify(desired)
    )
      return;
    const claimed = await save(link, {
      status: 'unknown',
      reason: 'ambiguous_write',
      updateAttempt: {
        ...attempt,
        phase: 'unknown',
        expectedFingerprint: projectionFingerprint(prepared.projection),
        connectionId: options.connectionId ?? null,
      },
    });
    if (!claimed) return;
    link = claimed;
    await access('workouts:plan');
    if (
      !currentWorkout(link) ||
      JSON.stringify(publicationWorkoutSchema.parse(currentWorkout(link))) !==
        JSON.stringify(desired)
    )
      return;
    try {
      await client.updateTrainingOnce(
        link.remoteTrainingId!,
        prepared.body,
        async () => {
          await access('workouts:plan');
          const latest = repository
            .list(link.ownerId)
            .find((row) => row.id === link.id);
          const current = currentWorkout(link);
          if (
            !latest ||
            latest.revision !== link.revision ||
            latest.state.updateAttempt?.id !== attempt.id ||
            latest.state.updateAttempt.phase !== 'unknown' ||
            !current ||
            JSON.stringify(publicationWorkoutSchema.parse(current)) !==
              JSON.stringify(desired)
          )
            throw new Error('Update intent changed');
        },
      );
    } catch {
      /* Never replay; the durable attempt is verified only through reads. */
    }
    await access('workouts:plan');
    await verify(link);
  }
  async function process(link: SyncLink) {
    await access('workouts:read');
    if (
      (!link.state.attempted && link.remoteTrainingId === null) ||
      (link.state.published && link.state.updateAttempt?.phase !== 'unknown')
    ) {
      await access('workouts:plan');
      const plan = currentPlan(link);
      if (plan) {
        const latest = repository.reconcile(link, plan);
        if (!latest) return;
        link = latest;
      } else if (!link.state.attempted && link.remoteTrainingId === null)
        return;
    }
    if (!client) {
      await save(link, { status: 'unavailable', reason: 'not_configured' });
      return;
    }
    if (link.state.updateAttempt?.phase === 'pending' && currentWorkout(link)) {
      await update(link);
      return;
    }
    if (link.state.attempted || link.remoteTrainingId !== null) {
      await verify(link);
      return;
    }
    if (!currentWorkout(link)) return; // Orphan links never create.
    if (changed(link)) {
      await save(link, { status: 'conflict', reason: 'plan_changed' });
      return;
    }
    if (link.state.reason === 'unsupported') return;
    const workout = link.state.workout;
    if (!workout.exercises.every((e) => e.transformMate)) {
      await save(link, { status: 'unavailable', reason: 'unsupported' });
      return;
    }
    try {
      for (const exercise of workout.exercises) {
        const { body } = await http(() =>
          client.getExercise(exercise.transformMate!.exerciseId),
        );
        if (
          body.id !== exercise.transformMate!.exerciseId ||
          !canProject(
            body,
            exercise.sets.some((s) => s.weightKg !== null),
          )
        ) {
          await save(link, { status: 'unavailable', reason: 'unsupported' });
          return;
        }
      }
    } catch {
      await access('workouts:read');
      await save(link, { status: 'error', reason: 'upstream_error' });
      return;
    }
    await access('workouts:plan');
    if (!currentWorkout(link)) return;
    if (changed(link)) {
      await save(link, { status: 'conflict', reason: 'plan_changed' });
      return;
    }
    const planRevision = currentPlan(link)?.revision;
    const body = createProjection(workout, link.state.marker);
    // Claim before HTTP. A crash here deliberately becomes unknown, never another POST.
    const claimed = await save(link, {
      attempted: true,
      status: 'unknown',
      reason: 'ambiguous_write',
      expected: expectedProjection(body),
    });
    if (!claimed) return;
    link = claimed;
    await access('workouts:plan');
    if (!currentWorkout(link) || changed(link)) return;
    try {
      const result = await client.createTraining(body, async () => {
        await access('workouts:plan');
        const latest = repository
          .list(link.ownerId)
          .find((row) => row.id === link.id);
        const current = currentPlan(link);
        if (
          !latest ||
          latest.revision !== link.revision ||
          !latest.state.attempted ||
          latest.remoteTrainingId !== null ||
          latest.state.expected !== link.state.expected ||
          !current ||
          current.revision !== planRevision ||
          !currentWorkout(link) ||
          changed(link)
        )
          throw new Error('Create intent changed');
      });
      await access('workouts:plan');
      const next = await save(link, {}, result.body.id);
      if (next) await verify(next);
    } catch {
      await access('workouts:plan');
      await verify(link); // Read-only recovery; ambiguous attempts never POST again.
    }
  }
  return { process };
}
