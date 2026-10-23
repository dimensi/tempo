import 'server-only';
import { z } from 'zod';
import { publicationWorkoutSchema } from '@/contracts/workout-publication';
import {
  transformMateActualSchema,
  transformMateSyncStatusSchema,
  transformMateSyncItemSchema,
} from '@/contracts/transformmate';

const domainSnapshot = z.object({
  workout: publicationWorkoutSchema,
  planTitle: z.string().max(160),
});
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const syncStateSchema = z.object({
  version: z.literal(1),
  workout: publicationWorkoutSchema,
  planTitle: z.string().max(160),
  marker: z
    .string()
    .max(54)
    .regex(
      /^\[yazio-dashboard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i,
    ),
  attempted: z.boolean(),
  status: transformMateSyncStatusSchema,
  reason: transformMateSyncItemSchema.shape.reason,
  expected: z
    .string()
    .max(2 * 1024 * 1024)
    .nullable(),
  baseline: z
    .string()
    .max(2 * 1024 * 1024)
    .nullable(),
  occurrences: z
    .array(
      z.object({
        remoteId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        key: z.uuid(),
      }),
    )
    .max(100),
  checkedAt: z.iso.datetime().nullable(),
  actual: transformMateActualSchema.nullable(),
  published: domainSnapshot
    .extend({
      authorId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  customExercises: z
    .array(
      z.object({
        key: z.uuid(),
        name: z.string().max(160),
        marker: z.string().max(100),
        accountScope: z.string(),
        phase: z.enum(['unknown', 'verified']),
        remoteId: z.number().int().positive().nullable(),
      }),
    )
    .max(50)
    .optional(),
  lifecycle: z
    .object({
      status: z.enum(['planned', 'in_progress', 'completed']),
      startedAt: z.iso.datetime().nullable(),
      finishedAt: z.iso.datetime().nullable(),
      historicalTimeUnknown: z.boolean(),
    })
    .optional(),
  execution: z
    .object({
      workout: publicationWorkoutSchema,
      revision: z.number().int().positive(),
      phase: z.enum(['unknown', 'verified', 'conflict']),
      previousFingerprint: fingerprint,
      expectedFingerprint: fingerprint,
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
      historicalTimeUnknown: z.boolean(),
    })
    .optional(),
  updateAttempt: z
    .object({
      id: z.uuid(),
      phase: z.enum(['pending', 'unknown', 'verified', 'conflict']),
      previous: domainSnapshot,
      desired: domainSnapshot,
      previousFingerprint: fingerprint,
      expectedFingerprint: fingerprint.nullable(),
      connectionId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
      checkedAt: z.iso.datetime().nullable(),
    })
    .optional(),
});
export type SyncState = z.infer<typeof syncStateSchema>;
export interface SyncLink {
  id: string;
  ownerId: string;
  planId: string;
  workoutId: string;
  remoteTrainingId: number | null;
  revision: number;
  state: SyncState;
}
