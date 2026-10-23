import { z } from 'zod';
import { measurementInputSchema } from './measurements';
import {
  workoutInputSchema,
  workoutActionSchema,
  exerciseFeedbackSchema,
} from './workouts';
const payload = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('measurement'), data: measurementInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal('workout'),
      data: workoutInputSchema,
      action: workoutActionSchema.optional(),
      feedback: exerciseFeedbackSchema.optional(),
    })
    .strict()
    .refine((value) => !(value.action && value.feedback)),
]);
export const offlineWriteSchema = z
  .object({
    id: z.uuid(),
    recordId: z.string().min(1).max(128),
    partition: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    yazioEpoch: z.number().int().nonnegative().nullable(),
    base: z.string().max(100).nullable(),
    payload,
  })
  .strict()
  .refine(
    (value) =>
      value.base !== null || z.uuid().safeParse(value.recordId).success,
    { message: 'New record requires a UUID' },
  );
export const writeRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    version: z.string().max(100),
    payload,
  })
  .strict();
export const writeCatalogSchema = z
  .object({
    partition: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    yazioEpoch: z.number().int().nonnegative().nullable(),
    records: z.array(writeRecordSchema).max(1000),
  })
  .strict();
export type WritePayload = z.infer<typeof payload>;
export type WriteRecord = z.infer<typeof writeRecordSchema>;
export type OfflineWrite = z.infer<typeof offlineWriteSchema>;
export type WriteCatalog = z.infer<typeof writeCatalogSchema>;
export type WriteStatus = 'local' | 'sending' | 'synced' | 'review';
