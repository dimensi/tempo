import 'server-only';
import { transformMateNativeSnapshotSchema } from '@/contracts/transformmate-native';
import type {
  TransformMateTrainingDetail,
  TransformMateTrainingSummary,
} from '@/server/transformmate/types';

/** Provider-only snapshot: deliberately has no local plan or write intent. */
export function nativeProjection(training: TransformMateTrainingDetail) {
  return transformMateNativeSnapshotSchema.parse({
    source: 'transformmate' as const,
    remoteTrainingId: training.id,
    date: training.date,
    title: training.name,
    progress: training.progress,
    started: training.started,
    finished: training.finished,
    remoteUpdatedAt: training.updated_at,
    exercises: [...training.protocols]
      .sort((a, b) => a.order - b.order)
      .flatMap((protocol) =>
        [...protocol.workout_exercises]
          .sort((a, b) => a.order - b.order)
          .map((exercise) => ({
            protocolId: protocol.id,
            protocolOrder: protocol.order,
            remoteExerciseId: exercise.id,
            exerciseId: exercise.exercise.id,
            order: exercise.order,
            name: exercise.exercise.name,
            comment: exercise.comment,
            metrics: exercise.metrics.map((group) => ({
              type: group.type,
              sets: [...group.sets]
                .sort((a, b) => a.order - b.order)
                .map((set) => ({
                  order: set.order,
                  done: 'is_done' in set ? set.is_done : null,
                  metrics: set.set_metrics.map((metric) => ({
                    key: metric.measure.key,
                    name: metric.measure.name,
                    unit: metric.measure.short_name,
                    type: metric.type,
                    values: metric.metric_values.map((value) => value.value),
                  })),
                })),
            })),
          })),
      ),
  });
}

/** Exclude app-created records even when an ambiguous write has not recovered its ID. */
export function isNativeTraining(
  training: Pick<TransformMateTrainingSummary, 'id' | 'description'>,
  linkedRemoteIds: ReadonlySet<number>,
) {
  return (
    !linkedRemoteIds.has(training.id) &&
    !/\[yazio-dashboard:[^\]\r\n]+\]/.test(training.description)
  );
}
