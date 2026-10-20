import { z } from 'zod';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { timezoneSchema } from '@/contracts/nutrition-sync-dates';

export const mcpTools = [
  'get_profile',
  'get_nutrition',
  'get_body_metrics',
  'get_activity',
  'get_workouts',
  'get_data_coverage',
] as const;
export type McpTool = (typeof mcpTools)[number];
export const mcpHistoryInput = z
  .strictObject({
    from: z.iso.date().refine((v) => v >= '1901-01-01'),
    to: z.iso.date().refine((v) => v <= '9998-12-31'),
    timezone: timezoneSchema.default('UTC'),
    detail: z.enum(['summary', 'daily', 'records']).default('summary'),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .superRefine((v, ctx) => {
    if (!analyticsRangeSchema.safeParse({ from: v.from, to: v.to }).success)
      ctx.addIssue({
        code: 'custom',
        message: 'Use an ordered range of at most 366 days',
      });
    if (
      v.detail === 'records' &&
      (Date.parse(v.to) - Date.parse(v.from)) / 86400000 >= 31
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Record detail supports at most 31 days',
      });
  });
export type McpHistoryInput = z.infer<typeof mcpHistoryInput>;
export const mcpProfileInput = z.strictObject({});
/** Execution evidence, independent of snapshot availability or sync status. */
export const mcpWorkoutExecutionStatus = z.enum([
  'planned',
  'not_started',
  'in_progress',
  'completed',
  'skipped',
  'unknown',
]);
export type McpWorkoutExecutionStatus = z.infer<
  typeof mcpWorkoutExecutionStatus
>;
export const mcpOutput = z.strictObject({
  version: z.literal(1),
  data: z.record(z.string(), z.unknown()),
  next_cursor: z.string().nullable(),
});
