import { z } from 'zod';
import { measurementInputSchema } from './measurements';
import { sessionCreateSchema } from './workouts';
const payload = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('measurement'), data: measurementInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal('workout'),
      data: sessionCreateSchema,
      planRevision: z.number().int().positive().optional(),
    })
    .strict(),
]);
export const offlineWriteSchema = z
  .object({
    id: z.uuid(),
    recordId: z.uuid(),
    partition: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    yazioEpoch: z.number().int().nonnegative().nullable(),
    base: z.string().max(100).nullable(),
    payload,
  })
  .strict();
export const writeRecordSchema = z
  .object({
    id: z.uuid(),
    version: z.string().max(100),
    payload,
  })
  .strict();
export const writeCatalogSchema = z
  .object({
    partition: offlineWriteSchema.shape.partition,
    yazioEpoch: z.number().int().nonnegative().nullable(),
    records: z.array(writeRecordSchema).max(1000),
  })
  .strict();
export type WritePayload = z.infer<typeof payload>;
export type WriteRecord = z.infer<typeof writeRecordSchema>;
export type OfflineWrite = z.infer<typeof offlineWriteSchema>;
export type WriteCatalog = z.infer<typeof writeCatalogSchema>;
export type WriteStatus = 'local' | 'sending' | 'synced' | 'review';
