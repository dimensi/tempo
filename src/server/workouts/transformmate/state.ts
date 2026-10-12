import 'server-only';
import { z } from 'zod';
import { plannedWorkoutSchema } from '@/contracts/workouts';
import {
  transformMateActualSchema,
  transformMateSyncStatusSchema,
  transformMateSyncItemSchema,
} from '@/contracts/transformmate';

const domainSnapshot = z.object({
  workout: plannedWorkoutSchema,
  planTitle: z.string().max(160),
});
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const syncStateSchema = z.object({
  version: z.literal(1),
  workout: plannedWorkoutSchema,
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
