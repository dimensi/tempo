import 'server-only';
import {
  plannedWorkoutSchema,
  type WorkoutPlan,
  type PlannedWorkout,
} from '@/contracts/workouts';
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
} from './mapping';

export interface SyncEngineOptions {
  repository: SyncRepository;
  client: Pick<
    TransformMateClient,
    'getExercise' | 'createTraining' | 'listTrainings' | 'getTraining'
  > | null;
  // Must throw on revocation. Called before and after each HTTP await and before local writes.
  access: (permission: 'workouts:read' | 'workouts:plan') => Promise<void>;
  plans: () => WorkoutPlan[];
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
  const { repository, client, access, plans } = options;
  const currentPlan = (link: SyncLink) =>
    plans().find((p) => p.id === link.planId && p.ownerId === link.ownerId);
  const currentWorkout = (link: SyncLink): PlannedWorkout | undefined =>
    currentPlan(link)?.workouts.find((w) => w.id === link.workoutId);
  const changed = (link: SyncLink) => {
    const current = currentWorkout(link);
    return (
      current &&
      JSON.stringify(plannedWorkoutSchema.parse(current)) !==
        JSON.stringify(link.state.workout)
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
      const matched =
        projection === (link.state.baseline ?? link.state.expected);
      const owned =
        body.id === id &&
        body.is_mine &&
        body.description === link.state.marker;
      const started =
        body.started !== null ||
        body.finished !== null ||
        body.progress !== 'idle';
      const newlyVerified = link.state.baseline === null;
      const valid =
        owned &&
        matched &&
        (!newlyVerified ||
          started ||
          initialPlaceholders(body, link.state.workout));
      // An ownership mismatch may refer to someone else's workout: do not cache its facts.
      if (!owned) {
        await save(link, { status: 'conflict', reason: 'remote_changed' });
        return;
      }
      const actual = actualProjection(body, link.state, matched);
      const status = started
        ? 'started'
        : !valid
          ? 'conflict'
          : changed(link)
            ? 'conflict'
            : 'synced';
      const reason = started
        ? 'remote_started'
        : !valid
          ? 'remote_changed'
          : changed(link)
            ? 'plan_changed'
            : null;
      await save(link, {
        status,
        reason,
        actual,
        checkedAt: new Date().toISOString(),
        baseline: valid ? projection : link.state.baseline,
        occurrences: valid
          ? remoteExercises(body).map((e, i) => ({
              remoteId: e.id,
              key: link.state.workout.exercises[i]!.transformMate!
                .occurrenceKey,
            }))
          : link.state.occurrences,
      });
    } catch (error) {
      // Keep facts and last successful checkedAt. Authorization exceptions are rethrown here.
      await access('workouts:read');
      await save(link, {
        status: link.state.baseline === null ? 'unknown' : 'error',
        reason:
          link.state.baseline === null
            ? 'ambiguous_write'
            : error instanceof TransformMateApiError && error.status === 404
              ? 'missing_remote'
              : 'upstream_error',
      });
    }
  }
  async function process(link: SyncLink) {
    await access('workouts:read');
    if (!link.state.attempted && link.remoteTrainingId === null) {
      await access('workouts:plan');
      const plan = currentPlan(link);
      if (!plan) return;
      const latest = repository.reconcile(link, plan);
      if (!latest) return;
      link = latest;
    }
    if (!client) {
      await save(link, { status: 'unavailable', reason: 'not_configured' });
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
      const result = await client.createTraining(body);
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
