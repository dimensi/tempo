import { z } from 'zod';
export const bodyMetricKeys = {
  weight: 'weight',
  waist: 'circumference.waist',
  hips: 'circumference.hip',
  chest: 'circumference.chest',
  thigh: 'circumference.thigh',
  biceps: 'circumference.arm',
} as const;
export type BodyMetric = keyof typeof bodyMetricKeys;
export const bodyMetricSchema = z.enum([
  'weight',
  'waist',
  'hips',
  'chest',
  'thigh',
  'biceps',
]);
export const bodyDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .refine(
    (value) =>
      z.iso.date().safeParse(value.slice(0, 10)).success &&
      Number(value.slice(11, 13)) < 24 &&
      Number(value.slice(14, 16)) < 60 &&
      Number(value.slice(17)) < 60,
  );
export const bodyEntrySchema = z.object({
  id: z.uuid().transform((id) => id.toLowerCase()),
  date: bodyDateTimeSchema,
  value: z.number().positive().max(9999.999),
  source: z.string().max(128).nullable().optional(),
  gateway: z.string().max(128).nullable().optional(),
});
// The APK descriptor makes each group optional with a null default. Unknown
// keys (including error envelopes) are rejected; omitted groups are empty.
export const bodySummarySchema = z
  .object({
    ...(Object.fromEntries(
      Object.values(bodyMetricKeys).map((key) => [
        key,
        z.array(bodyEntrySchema).max(1000).nullable().optional(),
      ]),
    ) as Record<
      (typeof bodyMetricKeys)[BodyMetric],
      z.ZodOptional<z.ZodNullable<z.ZodArray<typeof bodyEntrySchema>>>
    >),
    'ratio.fat': z.array(bodyEntrySchema).max(1000).nullable().optional(),
    'ratio.muscle': z.array(bodyEntrySchema).max(1000).nullable().optional(),
    bloodpressure: z
      .array(
        bodyEntrySchema.omit({ value: true }).extend({
          systolic: z.number().positive(),
          diastolic: z.number().positive(),
        }),
      )
      .max(1000)
      .nullable()
      .optional(),
    glucoselevel: z.array(bodyEntrySchema).max(1000).nullable().optional(),
  })
  .strict();
export type BodyEntry = z.infer<typeof bodyEntrySchema>;
export type BodySummary = z.infer<typeof bodySummarySchema>;
export const bodyRangeSchema = z
  .array(bodyEntrySchema.pick({ date: true, value: true }))
  .max(1000);
export const measurementSyncSchema = z.object({
  metric: bodyMetricSchema,
  state: z.enum([
    'pending',
    'synced',
    'failed',
    'uncertain',
    'conflict',
    'disconnected',
  ]),
  remoteValue: z.string().nullable(),
});
export type MeasurementSync = z.infer<typeof measurementSyncSchema>;
export const measurementPrecisionIssueSchema = z.object({
  id: z.uuid(),
  metric: bodyMetricSchema,
  date: z.iso.date(),
  dateTime: bodyDateTimeSchema,
  value: z.string(),
});
export type MeasurementPrecisionIssue = z.infer<
  typeof measurementPrecisionIssueSchema
>;
export function bodyMetric(metric: string): metric is BodyMetric {
  return Object.hasOwn(bodyMetricKeys, metric);
}
