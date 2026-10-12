import { z } from 'zod';
import { plannedWorkoutSchema } from '@/contracts/workouts';

const remoteId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const transformMateCatalogItemSchema = z.object({
  id: remoteId,
  name: z.string().max(500),
  canPlan: z.boolean(),
});
export type TransformMateCatalogItem = z.infer<
  typeof transformMateCatalogItemSchema
>;
export const transformMateExerciseInfoSchema = z.object({
  id: remoteId,
  name: z.string().max(500),
  description: z.string().max(20000),
  canPlan: z.boolean(),
  hasVideo: z.boolean(),
});
export type TransformMateExerciseInfo = z.infer<
  typeof transformMateExerciseInfoSchema
>;
export const transformMateActualSchema = z.object({
  date: z.iso.date(),
  title: z.string().max(500),
  started: z.string().nullable(),
  finished: z.string().nullable(),
  exercises: z
    .array(
      z.object({
        occurrenceKey: z.string().nullable(),
        exerciseId: remoteId,
        name: z.string().max(500),
        comment: z.string().max(4000),
        sets: z
          .array(
            z.object({
              order: z.number().int().positive(),
              done: z.boolean(),
              // Preserve unsupported/empty/range metrics without inventing numeric results.
              metrics: z
                .array(
                  z.object({
                    name: z.string().max(500),
                    unit: z.string().max(100),
                    type: z.string().max(100),
                    values: z.array(z.string().max(1000)).max(100),
                  }),
                )
                .max(50),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});
export type TransformMateActual = z.infer<typeof transformMateActualSchema>;
export const transformMateSyncStatusSchema = z.enum([
  'pending',
  'synced',
  'unavailable',
  'error',
  'conflict',
  'started',
  'unknown',
]);
export const transformMateSyncItemSchema = z.object({
  id: z.uuid(),
  planId: z.string(),
  workoutId: z.string(),
  remoteTrainingId: remoteId.nullable(),
  planSnapshot: z.object({
    planTitle: z.string().max(160),
    workout: plannedWorkoutSchema,
  }),
  status: transformMateSyncStatusSchema,
  reason: z
    .enum([
      'not_configured',
      'unsupported',
      'remote_changed',
      'plan_changed',
      'remote_started',
      'ambiguous_write',
      'upstream_error',
      'missing_remote',
    ])
    .nullable(),
  checkedAt: z.iso.datetime().nullable(),
  actual: transformMateActualSchema.nullable(),
});
export type TransformMateSyncItem = z.infer<typeof transformMateSyncItemSchema>;
export interface TransformMateSyncData {
  configured: boolean;
  items: TransformMateSyncItem[];
}
