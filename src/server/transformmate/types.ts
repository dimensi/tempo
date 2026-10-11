import type { z } from 'zod';
import type {
  transformMateTrainingSummarySchema,
  transformMateTrainingDetailSchema,
  transformMateWorkoutExerciseSchema,
  transformMatePlanMetricsSchema,
  transformMateFactMetricsSchema,
} from '@/server/transformmate/schemas';

export interface TransformMateTokenProvider {
  getIdToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** Sanitizes additional provider credentials that an upstream might echo. */
  redact?(text: string): string;
}

/** Transport metadata; raw methods default to an unvalidated body. */
export interface RawResponse<T = unknown> {
  status: number;
  statusText: string;
  contentType: string;
  isJson: boolean;
  body: T;
}
export type TransformMateTrainingSummary = z.infer<
  typeof transformMateTrainingSummarySchema
>;
export type TransformMateTrainingDetail = z.infer<
  typeof transformMateTrainingDetailSchema
>;
export type TransformMateWorkoutExercise = z.infer<
  typeof transformMateWorkoutExerciseSchema
>;
export type TransformMatePlanMetrics = z.infer<
  typeof transformMatePlanMetricsSchema
>;
export type TransformMateFactMetrics = z.infer<
  typeof transformMateFactMetricsSchema
>;
export type TransformMatePlanSet = TransformMatePlanMetrics['sets'][number];
export type TransformMateFactSet = TransformMateFactMetrics['sets'][number];
export type TransformMateSetMetric =
  TransformMatePlanSet['set_metrics'][number];
export type TransformMateMetricValue =
  TransformMateSetMetric['metric_values'][number];
