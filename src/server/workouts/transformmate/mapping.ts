import 'server-only';
import { createHash } from 'node:crypto';
import { trainingWriteSnapshot } from '@/server/transformmate/write-snapshot';
import type { PlannedWorkout } from '@/contracts/workouts';
import {
  transformMateActualSchema,
  type TransformMateActual,
} from '@/contracts/transformmate';
import type {
  TransformMateTrainingDetail,
  TransformMateExerciseDetail,
} from '@/server/transformmate/types';
import type { TrainingWriteBody } from '@/server/transformmate/write-inputs';
import type { SyncState } from './state';

export function canProject(
  detail: TransformMateExerciseDetail,
  weighted: boolean,
) {
  void weighted;
  return (
    detail.metrics.length === 2 &&
    [3, 4].every((id) =>
      detail.metrics.some(
        (m) =>
          m.id === id &&
          m.key === (id === 3 ? 'weight' : 'reps') &&
          m.set_metric_types.some((t) => t.type === 'straight'),
      ),
    )
  );
}
export function createProjection(
  workout: PlannedWorkout,
  marker: string,
): TrainingWriteBody {
  return {
    name: workout.title,
    date: workout.date,
    description: marker,
    protocols: [
      {
        workout_exercises: workout.exercises.map((e) => {
          if (!e.transformMate) throw new Error('Unsupported exercise');
          const measures = e.sets.some((s) => s.weightKg !== null)
            ? [3, 4]
            : [4];
          return {
            exercise: e.transformMate.exerciseId,
            comment: e.comment ?? '',
            exercise_metrics: measures,
            metrics: [
              {
                type: 'plan',
                sets: e.sets.map((s) => ({
                  techniques: [],
                  set_metrics: [
                    ...(s.weightKg === null
                      ? []
                      : [
                          {
                            type: 'straight' as const,
                            measure: 3,
                            metric_values: [{ value: String(s.weightKg) }],
                          },
                        ]),
                    {
                      type: 'straight' as const,
                      measure: 4,
                      metric_values: [{ value: String(s.reps) }],
                    },
                  ],
                })),
              },
              {
                type: 'fact',
                sets: e.sets.map(() => ({
                  is_done: false,
                  techniques: [],
                  set_metrics: [],
                })),
              },
            ],
          };
        }),
      },
    ],
  };
}
// Projection ignores volatile database IDs and current actual values. Ordering remains semantic.
export function expectedProjection(body: TrainingWriteBody) {
  return JSON.stringify({
    name: body.name,
    description: body.description,
    date: body.date,
    protocols: body.protocols.map((p, pi) => ({
      order: pi + 1,
      exercises: p.workout_exercises.map((e, ei) => ({
        order: ei + 1,
        exercise: e.exercise,
        comment: e.comment,
        target: null,
        video: false,
        warmup: {},
        planGroups: 1,
        measures: [...e.exercise_metrics].sort((a, b) => a - b),
        sets: e.metrics
          .find((m) => m.type === 'plan')!
          .sets.map((s, si) => ({
            order: si + 1,
            techniques: s.techniques ?? [],
            metrics: s.set_metrics.map((m) => ({
              measure: m.measure,
              type: m.type ?? 'straight',
              values: m.metric_values.map((v) => v.value),
            })),
          })),
      })),
    })),
  });
}
export function remoteExercises(training: TransformMateTrainingDetail) {
  return [...training.protocols]
    .sort((a, b) => a.order - b.order)
    .flatMap((p) => [...p.workout_exercises].sort((a, b) => a.order - b.order));
}
export function validateRemoteOrder(training: TransformMateTrainingDetail) {
  const unique = (orders: number[]) => {
    if (new Set(orders).size !== orders.length)
      throw new Error('Ambiguous remote order');
  };
  unique(training.protocols.map((p) => p.order));
  for (const protocol of training.protocols) {
    unique(protocol.workout_exercises.map((e) => e.order));
    for (const exercise of protocol.workout_exercises) {
      if (
        new Set(exercise.metrics.map((m) => m.type)).size !==
        exercise.metrics.length
      )
        throw new Error('Ambiguous remote metrics');
      for (const metrics of exercise.metrics)
        unique(metrics.sets.map((s) => s.order));
    }
  }
}
export function remoteProjection(training: TransformMateTrainingDetail) {
  return JSON.stringify({
    name: training.name,
    description: training.description,
    date: training.date,
    protocols: [...training.protocols]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        order: p.order,
        exercises: [...p.workout_exercises]
          .sort((a, b) => a.order - b.order)
          .map((e) => ({
            order: e.order,
            exercise: e.exercise.id,
            comment: e.comment,
            target: e.target_indication,
            video: e.videoreport_required,
            warmup: e.warmup_metrics,
            planGroups: e.metrics.filter((m) => m.type === 'plan').length,
            measures: e.exercise_metrics.map((m) => m.id).sort((a, b) => a - b),
            sets:
              e.metrics
                .find((m) => m.type === 'plan')
                ?.sets.slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => ({
                  order: s.order,
                  techniques: s.techniques,
                  metrics: s.set_metrics.map((m) => ({
                    measure: m.measure.id,
                    type: m.type,
                    values: m.metric_values.map((v) => v.value),
                  })),
                })) ?? [],
          })),
      })),
  });
}
export function initialPlaceholders(
  training: TransformMateTrainingDetail,
  workout: PlannedWorkout,
) {
  const exercises = remoteExercises(training);
  return (
    exercises.length === workout.exercises.length &&
    exercises.every((e, i) => {
      const fact = e.metrics.filter((m) => m.type === 'fact');
      return (
        fact.length === 1 &&
        fact[0]!.sets.length === workout.exercises[i]!.sets.length &&
        fact[0]!.sets.every(
          (s) =>
            !('is_done' in s && s.is_done) &&
            s.set_metrics.length === 0 &&
            s.techniques.length === 0,
        )
      );
    })
  );
}
export function actualProjection(
  training: TransformMateTrainingDetail,
  state: SyncState,
  matched: boolean,
): TransformMateActual {
  return transformMateActualSchema.parse({
    date: training.date,
    title: training.name,
    started: training.started,
    finished: training.finished,
    exercises: remoteExercises(training).map((e, i) => ({
      occurrenceKey: matched
        ? ((state.published?.workout ?? state.workout).exercises[i]
            ?.transformMate?.occurrenceKey ?? null)
        : null,
      exerciseId: e.exercise.id,
      name: e.exercise.name,
      comment: e.comment,
      sets: e.metrics
        .filter((m) => m.type === 'fact')
        .flatMap((m) => m.sets)
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          order: s.order,
          done: 'is_done' in s ? s.is_done : false,
          metrics: s.set_metrics.map((m) => ({
            name: m.measure.name,
            unit: m.measure.short_name,
            type: m.type,
            values: m.metric_values.map((v) => v.value),
          })),
        })),
    })),
  });
}

export function projectionFingerprint(projection: string) {
  if (Buffer.byteLength(projection, 'utf8') > 2 * 1024 * 1024)
    throw new Error('Invalid projection');
  return createHash('sha256').update(projection).digest('hex');
}
export function hasRemoteFact(training: TransformMateTrainingDetail) {
  return training.protocols.some((p) =>
    p.workout_exercises.some((e) =>
      e.metrics.some(
        (m) =>
          m.type === 'fact' &&
          m.sets.some(
            (s) =>
              ('is_done' in s && s.is_done) ||
              s.set_metrics.length > 0 ||
              s.techniques.length > 0,
          ),
      ),
    ),
  );
}
/** Verified ordered correspondence binds local occurrences, never remote fact IDs. */
export function updateProjection(
  training: TransformMateTrainingDetail,
  previous: PlannedWorkout,
  desired: PlannedWorkout,
) {
  validateRemoteOrder(training);
  if (training.protocols.length !== 1)
    throw new Error('Unsupported projection');
  const remote = remoteExercises(training);
  if (remote.length !== previous.exercises.length)
    throw new Error('Unsupported projection');
  const fresh = trainingWriteSnapshot({
    ...training,
    protocols: [
      {
        ...training.protocols[0]!,
        workout_exercises: remote.map((e) => ({
          ...e,
          metrics: e.metrics.map((m) =>
            m.type === 'plan'
              ? { ...m, sets: [...m.sets].sort((a, b) => a.order - b.order) }
              : { ...m, sets: [...m.sets].sort((a, b) => a.order - b.order) },
          ),
        })),
      },
    ],
  });
  const byKey = new Map(
    previous.exercises.map((e, i) => {
      if (
        !e.transformMate ||
        remote[i]!.exercise.id !== e.transformMate.exerciseId
      )
        throw new Error('Unsupported projection');
      if (
        remote[i]!.metrics.filter((m) => m.type === 'plan').length !== 1 ||
        remote[i]!.metrics.filter((m) => m.type === 'fact').length !== 1
      )
        throw new Error('Unsupported projection');
      return [
        e.transformMate.occurrenceKey,
        { wire: remote[i]!, body: fresh.protocols[0]!.workout_exercises[i]! },
      ];
    }),
  );
  if (
    byKey.size !== previous.exercises.length ||
    new Set(desired.exercises.map((e) => e.transformMate?.occurrenceKey))
      .size !== desired.exercises.length
  )
    throw new Error('Unsupported projection');
  const templates: ((typeof remote)[number] | undefined)[] = [];
  fresh.name = desired.title;
  fresh.date = desired.date;
  fresh.protocols[0]!.workout_exercises = desired.exercises.map((e, i) => {
    if (!e.transformMate) throw new Error('Unsupported projection');
    const candidate = byKey.get(e.transformMate.occurrenceKey);
    const matched =
      candidate?.wire.exercise.id === e.transformMate.exerciseId
        ? candidate
        : undefined;
    templates[i] = matched?.wire;
    const projected = createProjection(
      { ...desired, exercises: [e] },
      training.description,
    ).protocols[0]!.workout_exercises[0]!;
    if (!matched) return projected;
    const existing = matched.body;
    const oldPlan = existing.metrics.find((m) => m.type === 'plan')!;
    const oldFact = existing.metrics.find((m) => m.type === 'fact')!;
    const newPlan = projected.metrics.find((m) => m.type === 'plan')!;
    existing.comment = e.comment ?? '';
    existing.exercise_metrics = projected.exercise_metrics;
    oldPlan.sets = newPlan.sets.map((next, index) => {
      const prior = oldPlan.sets[index];
      if (!prior) return next;
      return {
        ...prior,
        set_metrics: next.set_metrics.map((metric) => {
          const old = prior.set_metrics.find(
            (m) => m.measure === metric.measure,
          );
          return {
            ...metric,
            ...(old?.id ? { id: old.id } : {}),
            metric_values: metric.metric_values.map((v, vi) => ({
              ...v,
              ...(old?.metric_values[vi]?.id
                ? { id: old.metric_values[vi]!.id }
                : {}),
            })),
          };
        }),
      };
    });
    oldFact.sets = newPlan.sets.map(
      (_, index) =>
        oldFact.sets[index] ?? {
          is_done: false,
          techniques: [],
          set_metrics: [],
        },
    );
    return existing;
  });
  // Build the expected semantic projection while retaining response metadata labels/references.
  const projection = JSON.stringify({
    name: fresh.name,
    description: fresh.description,
    date: fresh.date,
    protocols: [
      {
        order: 1,
        exercises: fresh.protocols[0]!.workout_exercises.map((e, i) => ({
          order: i + 1,
          exercise: e.exercise,
          comment: e.comment,
          target: templates[i]?.target_indication ?? null,
          video: e.videoreport_required ?? false,
          warmup: templates[i]?.warmup_metrics ?? {},
          planGroups: 1,
          measures: [...e.exercise_metrics].sort((a, b) => a - b),
          sets: e.metrics
            .find((m) => m.type === 'plan')!
            .sets.map((set, si) => ({
              order: si + 1,
              techniques:
                templates[i]?.metrics
                  .find((m) => m.type === 'plan')
                  ?.sets.slice()
                  .sort((a, b) => a.order - b.order)[si]?.techniques ??
                set.techniques ??
                [],
              metrics: set.set_metrics.map((m) => ({
                measure: m.measure,
                type: m.type ?? 'straight',
                values: m.metric_values.map((v) => v.value),
              })),
            })),
        })),
      },
    ],
  });
  projectionFingerprint(projection);
  return { body: fresh, projection };
}
