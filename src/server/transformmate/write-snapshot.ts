import 'server-only';
import { z } from 'zod';
import type { TransformMateTrainingDetail } from '@/server/transformmate/types';
import {
  createTrainingInputSchema,
  parseWriteInput,
} from '@/server/transformmate/write-inputs';

const reference = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.looseObject({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);
function referenceId(value: unknown) {
  const parsed = parseWriteInput(reference, value);
  return typeof parsed === 'number' ? parsed : parsed.id;
}

/** APK ForUpdate DTO, not a response spread. Reject unsupported references/types. */
export function trainingWriteSnapshot(training: TransformMateTrainingDetail) {
  if (!training.is_mine)
    throw new Error('TransformMate training is not owned by current user');
  return parseWriteInput(createTrainingInputSchema, {
    name: training.name,
    description: training.description,
    date: training.date,
    ...(training.started ? { started: training.started } : {}),
    ...(training.finished ? { finished: training.finished } : {}),
    protocols: training.protocols.map((protocol) => ({
      id: protocol.id,
      workout_exercises: protocol.workout_exercises.map((exercise) => ({
        id: exercise.id,
        exercise: exercise.exercise.id,
        comment: exercise.comment,
        ...(exercise.target_indication == null
          ? {}
          : { target_indication: referenceId(exercise.target_indication) }),
        exercise_metrics: exercise.exercise_metrics.map((metric) => metric.id),
        videoreport_required: exercise.videoreport_required,
        metrics: exercise.metrics.map((group) => ({
          id: group.id,
          type: group.type,
          sets: group.sets.map((set) => ({
            id: set.id,
            ...(group.type === 'fact' && 'is_done' in set
              ? { is_done: set.is_done }
              : {}),
            techniques: set.techniques.map(referenceId),
            set_metrics: set.set_metrics.map((metric) => ({
              id: metric.id,
              type: metric.type,
              measure: metric.measure.id,
              metric_values: metric.metric_values.map((value) => ({
                id: value.id,
                value: value.value,
              })),
            })),
          })),
        })),
      })),
    })),
  });
}
