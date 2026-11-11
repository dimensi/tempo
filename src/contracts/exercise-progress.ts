import { z } from 'zod';
import { workoutSetSchema } from './workouts';

const exerciseId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const source = z.enum(['LOCAL', 'TransformMate']);
export const progressQuerySchema = z
  .object({
    ownerId: z.string().min(1).max(128),
    from: z.iso.date(),
    to: z.iso.date(),
    exerciseIds: z.array(exerciseId).max(50).optional(),
    exerciseId: exerciseId.optional(),
    workoutId: z.string().min(1).max(128).optional(),
    cursor: z.string().max(128).optional(),
  })
  .refine(
    (q) =>
      q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) < 366 * 86400000,
    { message: 'Invalid progress range' },
  );
export type ProgressQuery = z.infer<typeof progressQuerySchema>;
export const progressOccurrenceSchema = z.object({
  key: z.string(),
  exerciseId,
  name: z.string(),
  date: z.iso.date(),
  source,
  status: z.enum(['completed', 'in_progress']),
  href: z.string().startsWith('/workouts?'),
  comment: z.string().nullable(),
  fatigue: z.number().nullable(),
  failure: z.enum(['full', 'partial', 'none']).nullable(),
  possibleOverlap: z.boolean(),
  sets: z.array(
    z.object({
      order: z.number().int().positive(),
      value: workoutSetSchema.nullable(),
      metrics: z.array(
        z.object({
          name: z.string(),
          unit: z.string(),
          type: z.string(),
          values: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type ProgressOccurrence = z.infer<typeof progressOccurrenceSchema>;
export const progressStatsSchema = z.object({
  key: z.string(),
  date: z.iso.date(),
  source,
  best: workoutSetSchema.nullable(),
  volume: z.number().nullable(),
  repetitions: z.array(workoutSetSchema),
});
export type ProgressStats = z.infer<typeof progressStatsSchema>;
const summarySource = z.object({
  source,
  latest: progressOccurrenceSchema,
  previous: progressOccurrenceSchema.nullable(),
  best: workoutSetSchema.nullable(),
  completedCount: z.number().int().nonnegative(),
  repChange: z
    .object({
      weightKg: z.number().nullable(),
      previous: z.number(),
      current: z.number(),
    })
    .nullable(),
});
export const progressSummarySchema = z.object({
  version: z.literal(1),
  exercises: z.array(
    z.object({ exerciseId, name: z.string(), sources: z.array(summarySource) }),
  ),
  upstreamCompleteness: z.literal('unknown'),
});
export type ProgressSummary = z.infer<typeof progressSummarySchema>;
export const progressHistorySchema = z.object({
  version: z.literal(1),
  records: z.array(progressOccurrenceSchema),
  latest: z.array(progressOccurrenceSchema),
  points: z.array(progressStatsSchema),
  nextCursor: z.string().nullable(),
  upstreamCompleteness: z.literal('unknown'),
});
export type ProgressHistory = z.infer<typeof progressHistorySchema>;
