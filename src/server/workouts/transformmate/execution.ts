import 'server-only';
import type { Workout } from '@/contracts/workouts';
import type { TransformMateTrainingDetail } from '@/server/transformmate/types';
import type { TrainingWriteBody } from '@/server/transformmate/write-inputs';
import type { TransformMateClient } from '@/server/transformmate/client';
import { trainingWriteSnapshot } from '@/server/transformmate/write-snapshot';
import { publicationFor } from './publication';
import {
  actualProjection,
  hasRemoteFact,
  projectionFingerprint,
  remoteExercises,
  remoteProjection,
  updateProjection,
  validateRemoteOrder,
} from './mapping';
import type { SyncLink, SyncState } from './state';

const timestamp = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;
function factProjection(body: TrainingWriteBody) {
  return body.protocols.map((p) =>
    p.workout_exercises.map((e) =>
      e.metrics
        .filter((m) => m.type === 'fact')
        .map((m) =>
          m.sets.map((s) => ({
            done: s.is_done ?? false,
            techniques: s.techniques ?? [],
            metrics: s.set_metrics.map((metric) => ({
              measure: metric.measure,
              type: metric.type ?? 'straight',
              values: metric.metric_values.map((v) => v.value),
            })),
          })),
        ),
    ),
  );
}
export function executionFingerprint(
  body: TrainingWriteBody,
  projection: string,
) {
  return projectionFingerprint(
    JSON.stringify({
      plan: JSON.parse(projection),
      started: timestamp(body.started),
      finished: timestamp(body.finished),
      fact: factProjection(body),
    }),
  );
}
function remoteFingerprint(remote: TransformMateTrainingDetail) {
  validateRemoteOrder(remote);
  const ordered = structuredClone(remote);
  ordered.protocols.sort((a, b) => a.order - b.order);
  for (const protocol of ordered.protocols) {
    protocol.workout_exercises.sort((a, b) => a.order - b.order);
    for (const exercise of protocol.workout_exercises)
      for (const group of exercise.metrics)
        group.sets.sort((a, b) => a.order - b.order);
  }
  return executionFingerprint(
    trainingWriteSnapshot(ordered),
    remoteProjection(remote),
  );
}

/** One guarded full DTO write; a committed timeout is settled by GET, never replay. */
export async function syncExecution(options: {
  link: SyncLink;
  client: Pick<TransformMateClient, 'getTraining' | 'updateTrainingOnce'>;
  current(): Workout | undefined;
  guard(): Promise<void>;
  save(link: SyncLink, patch: Partial<SyncState>): Promise<SyncLink | null>;
}) {
  let link = options.link;
  const local = options.current();
  if (
    !local ||
    local.status === 'planned' ||
    !link.state.published ||
    link.remoteTrainingId === null ||
    !link.state.lifecycle?.startedAt
  )
    return;
  const guard = async () => {
    await options.guard();
    if (options.current()?.revision !== local.revision)
      throw new Error('Workout changed during execution sync');
  };
  await guard();
  const { body: remote } = await options.client.getTraining(
    link.remoteTrainingId,
  );
  await guard();
  if (
    remote.id !== link.remoteTrainingId ||
    !remote.is_mine ||
    remote.author !== link.state.published.authorId ||
    remote.description !== link.state.marker
  ) {
    await options.save(link, { status: 'conflict', reason: 'remote_changed' });
    return;
  }
  const fingerprint = remoteFingerprint(remote);
  const prior = link.state.execution;
  if (prior?.phase === 'unknown') {
    const matched = fingerprint === prior.expectedFingerprint;
    const settled = await options.save(link, {
      actual: actualProjection(
        remote,
        {
          ...link.state,
          published: { ...link.state.published!, workout: prior.workout },
        },
        matched,
      ),
      baseline: matched ? remoteProjection(remote) : link.state.baseline,
      published: matched
        ? { ...link.state.published!, workout: prior.workout }
        : link.state.published,
      updateAttempt: matched ? undefined : link.state.updateAttempt,
      checkedAt: new Date().toISOString(),
      status: matched
        ? prior.revision === local.revision
          ? 'synced'
          : 'pending'
        : fingerprint === prior.previousFingerprint
          ? 'unknown'
          : 'conflict',
      reason: matched
        ? prior.revision === local.revision
          ? null
          : 'plan_changed'
        : fingerprint === prior.previousFingerprint
          ? 'ambiguous_write'
          : 'remote_changed',
      execution: {
        ...prior,
        phase: matched
          ? 'verified'
          : fingerprint === prior.previousFingerprint
            ? 'unknown'
            : 'conflict',
      },
    });
    if (matched && settled && prior.revision !== local.revision)
      await syncExecution({ ...options, link: settled });
    return;
  }
  if (
    prior?.phase === 'conflict' ||
    (prior && fingerprint !== prior.expectedFingerprint) ||
    (!prior &&
      (remoteProjection(remote) !== link.state.baseline ||
        hasRemoteFact(remote) ||
        remote.started ||
        remote.finished))
  ) {
    await options.save(link, {
      status: 'conflict',
      reason: 'remote_changed',
      actual: actualProjection(remote, link.state, false),
      checkedAt: new Date().toISOString(),
    });
    return;
  }
  if (prior?.revision === local.revision) {
    await options.save(link, {
      status: 'synced',
      reason: null,
      updateAttempt: undefined,
      actual: actualProjection(remote, link.state, true),
      checkedAt: new Date().toISOString(),
    });
    return;
  }
  const desired = publicationFor(local).workouts[0]!;
  // Preserve original planned values for known occurrences; actual values have their own group.
  const previous = link.state.published.workout;
  const shape = {
    ...desired,
    exercises: desired.exercises.map((exercise) => {
      const planned = previous.exercises.find(
        (e) =>
          e.transformMate?.occurrenceKey ===
          exercise.transformMate?.occurrenceKey,
      );
      return {
        ...exercise,
        sets: exercise.sets.map((set, index) => planned?.sets[index] ?? set),
      };
    }),
  };
  const prepared = updateProjection(remote, previous, shape);
  const remoteByKey = new Map(
    previous.exercises.map((exercise, index) => [
      exercise.transformMate!.occurrenceKey,
      remoteExercises(remote)[index]!,
    ]),
  );
  prepared.body.protocols[0]!.workout_exercises.forEach((exercise, index) => {
    const actual = desired.exercises[index]!;
    const old = remoteByKey
      .get(actual.transformMate!.occurrenceKey)
      ?.metrics.find((m) => m.type === 'fact');
    const fact = exercise.metrics.find((m) => m.type === 'fact')!;
    fact.sets = actual.sets.map((set, setIndex) => {
      const previousSet = old?.sets[setIndex];
      return {
        ...(previousSet ? { id: previousSet.id } : {}),
        is_done: local.status === 'completed',
        techniques: [],
        set_metrics: [
          ...(set.weightKg === null
            ? []
            : [{ measure: 3, value: String(set.weightKg) }]),
          { measure: 4, value: String(set.reps) },
        ].map(({ measure, value }) => {
          const metric = previousSet?.set_metrics.find(
            (m) => m.measure.id === measure && m.type === 'straight',
          );
          return {
            ...(metric ? { id: metric.id } : {}),
            measure,
            type: 'straight' as const,
            metric_values: [
              {
                ...(metric?.metric_values[0]
                  ? { id: metric.metric_values[0].id }
                  : {}),
                value,
              },
            ],
          };
        }),
      };
    });
  });
  prepared.body.started = link.state.lifecycle.startedAt;
  prepared.body.finished = link.state.lifecycle.finishedAt;
  const expected = executionFingerprint(prepared.body, prepared.projection);
  const execution: NonNullable<SyncState['execution']> = {
    workout: shape,
    revision: local.revision,
    phase: 'unknown',
    previousFingerprint: fingerprint,
    expectedFingerprint: expected,
    startedAt: link.state.lifecycle.startedAt,
    finishedAt: link.state.lifecycle.finishedAt,
    historicalTimeUnknown: link.state.lifecycle.historicalTimeUnknown,
  };
  const claimed = await options.save(link, {
    execution,
    updateAttempt: undefined,
    status: 'unknown',
    reason: 'ambiguous_write',
  });
  if (!claimed) return;
  link = claimed;
  await guard();
  try {
    await options.client.updateTrainingOnce(
      link.remoteTrainingId!,
      prepared.body,
      guard,
    );
  } catch {
    // A failed response does not prove the PATCH failed. Read the durable intent.
  }
  await guard();
  const { body: verified } = await options.client.getTraining(
    link.remoteTrainingId!,
  );
  await guard();
  const matched =
    verified.id === link.remoteTrainingId &&
    verified.is_mine &&
    verified.author === link.state.published!.authorId &&
    verified.description === link.state.marker &&
    remoteFingerprint(verified) === expected;
  await options.save(link, {
    execution: { ...execution, phase: matched ? 'verified' : 'unknown' },
    status: matched ? 'synced' : 'unknown',
    reason: matched ? null : 'ambiguous_write',
    checkedAt: new Date().toISOString(),
    baseline: matched ? remoteProjection(verified) : link.state.baseline,
    published: matched
      ? { ...link.state.published!, workout: shape }
      : link.state.published,
    actual: actualProjection(
      verified,
      {
        ...link.state,
        published: { ...link.state.published!, workout: shape },
      },
      matched,
    ),
    updateAttempt: undefined,
  });
}
