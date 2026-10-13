import { z } from 'zod';
import { measurementSyncSchema } from './yazio-body';
export const measurementMetrics = [
  'weight',
  'waist',
  'chest',
  'hips',
  'neck',
  'biceps',
  'thigh',
] as const;
export const measurementMetricSchema = z.enum(measurementMetrics);
export type MeasurementMetric = z.infer<typeof measurementMetricSchema>;
export const measurementValueSchema = z
  .object({
    metric: measurementMetricSchema,
    value: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/)
      .refine((v) => Number(v) > 0),
    unit: z.enum(['kg', 'cm']),
  })
  .strict()
  .refine((v) => v.unit === (v.metric === 'weight' ? 'kg' : 'cm'), {
    message: 'Metric unit mismatch',
  });
export const measurementInputSchema = z
  .object({
    measuredAt: z.iso.date(),
    values: z.array(measurementValueSchema).min(1).max(7),
    note: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine(
    (v) => new Set(v.values.map((x) => x.metric)).size === v.values.length,
    { message: 'Duplicate metric' },
  );
export const measurementSchema = measurementInputSchema.safeExtend({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  sync: z.array(measurementSyncSchema),
});
export type MeasurementInput = z.infer<typeof measurementInputSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
