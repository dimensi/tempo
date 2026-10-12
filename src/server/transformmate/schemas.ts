import 'server-only';
import { z } from 'zod';

// Wire schemas only: no domain mapping, numeric coercion or stable set identity.
const remoteId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const order = z.number().int().positive();
const timestamp = z.iso.datetime({ offset: true });
const metricValue = z.looseObject({ id: remoteId, value: z.string() });
const measure = z.looseObject({
  id: remoteId,
  key: z.string().min(1), // Preserve future metric keys without inventing enums.
  name: z.string(),
  short_name: z.string(),
});
const setMetric = z.looseObject({
  id: remoteId,
  type: z.string(),
  measure,
  metric_values: z.array(metricValue),
});
const setFields = {
  id: remoteId,
  order,
  techniques: z.array(z.unknown()), // Only empty arrays observed in detail.
  set_metrics: z.array(setMetric),
};
export const transformMatePlanMetricsSchema = z.looseObject({
  id: remoteId,
  type: z.literal('plan'),
  sets: z.array(z.looseObject(setFields)),
});
export const transformMateFactMetricsSchema = z.looseObject({
  id: remoteId,
  type: z.literal('fact'),
  sets: z.array(z.looseObject({ ...setFields, is_done: z.boolean() })),
});
const metrics = z.discriminatedUnion('type', [
  transformMatePlanMetricsSchema,
  transformMateFactMetricsSchema,
]);

// Historical results use reduced measure references and omit set id/order/is_done.
const resultMetric = z.looseObject({
  type: z.string(),
  measure: z.looseObject({ id: remoteId }),
  metric_values: z.array(metricValue),
});
const lastResults = z.looseObject({
  type: z.enum(['plan', 'fact']).optional(),
  sets: z
    .array(
      z.looseObject({
        set_metrics: z.array(resultMetric),
      }),
    )
    .optional(),
});
export const transformMateWorkoutExerciseSchema = z.looseObject({
  id: remoteId,
  exercise: z.looseObject({ id: remoteId, name: z.string() }),
  order,
  comment: z.string(),
  warmup_metrics: z.record(z.string(), z.unknown()),
  target_indication: z.unknown(),
  videoreport_required: z.boolean(),
  exercise_metrics: z.array(z.looseObject({ id: remoteId, name: z.string() })),
  metrics: z.array(metrics),
  best_result: z.looseObject({ set_metrics: z.array(resultMetric).optional() }),
  last_results: lastResults,
  mediareports: z.array(z.unknown()),
  is_checked: z.boolean(),
});
const trainingFields = {
  id: remoteId,
  name: z.string(),
  description: z.string(),
  author: remoteId,
  is_mine: z.boolean(),
  date: z.iso.date(),
  started: timestamp.nullable(),
  finished: timestamp.nullable(),
  progress: z.string(), // idle/done observed; external status is not a domain enum.
  has_tokens: z.boolean(),
  has_access_for_copy: z.boolean(),
  has_access_for_sharing: z.boolean(),
  is_from_subscription: z.boolean(),
  label: z.string(),
  week: z.unknown(), // Only an empty string observed; populated shape unknown.
};
export const transformMateTrainingSummarySchema = z.looseObject({
  ...trainingFields,
  is_from_curator: z.boolean(),
});
export const transformMateTrainingsSchema = z.array(
  transformMateTrainingSummarySchema,
);
export const transformMateTrainingDetailSchema = z.looseObject({
  ...trainingFields,
  has_access_for_replacing: z.boolean(),
  protocols: z.array(
    z.looseObject({
      id: remoteId,
      order,
      workout_exercises: z.array(transformMateWorkoutExerciseSchema),
    }),
  ),
  mediareport_url: z.string(),
  start_check: timestamp.nullable(),
  end_check: timestamp.nullable(),
  report_time: timestamp.nullable(),
  report_msg: z.string(),
  updated_at: timestamp,
});
