import 'server-only';
import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const setMetricInputSchema = z.strictObject({
  id: id.optional(),
  type: z.enum(['straight', 'range', 'drop', 'two_in_one']).optional(),
  measure: id,
  metric_values: z.array(
    z.strictObject({ id: id.optional(), value: z.string() }),
  ),
});
export const setInputSchema = z.strictObject({
  id: id.optional(),
  is_done: z.boolean().optional(),
  techniques: z.array(id).optional(),
  set_metrics: z.array(setMetricInputSchema),
});
const metricsInputSchema = z.strictObject({
  id: id.optional(),
  type: z.enum(['plan', 'fact']),
  sets: z.array(setInputSchema),
});
export const exerciseInputSchema = z.strictObject({
  id: id.optional(),
  exercise: id,
  comment: z.string(),
  target_indication: id.optional(),
  exercise_metrics: z.array(id),
  metrics: z.array(metricsInputSchema),
  videoreport_required: z.boolean().optional(),
});
export const protocolInputSchema = z.strictObject({
  id: id.optional(),
  workout_exercises: z.array(exerciseInputSchema),
});
export const createTrainingInputSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  date: z.iso.date(),
  protocols: z.array(protocolInputSchema).default([]),
  started: z.iso.datetime({ offset: true }).optional(),
  finished: z.iso.datetime({ offset: true }).optional(),
});
export const updateTrainingInputSchema = createTrainingInputSchema
  .omit({ protocols: true })
  .extend({ protocols: z.array(protocolInputSchema) })
  .partial();
export const updateSetInputSchema = setInputSchema.omit({ id: true }).partial();
export const addExerciseInputSchema = exerciseInputSchema
  .omit({ id: true, metrics: true })
  .extend({ protocolId: id.optional() });

export type CreateTrainingInput = z.input<typeof createTrainingInputSchema>;
export type UpdateTrainingInput = z.infer<typeof updateTrainingInputSchema>;
export type UpdateSetInput = z.infer<typeof updateSetInputSchema>;
export type SetInput = z.infer<typeof setInputSchema>;
export type AddExerciseInput = z.infer<typeof addExerciseInputSchema>;
export type TrainingWriteBody = z.output<typeof createTrainingInputSchema>;

/** No payload values or Zod issues in errors: inputs may contain private notes. */
export function parseWriteInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Invalid TransformMate write input');
  return result.data;
}
