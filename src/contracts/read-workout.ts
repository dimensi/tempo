import { z } from 'zod';
import {
  workoutPlanSchema,
  plannedWorkoutSchema,
  workoutSessionSchema,
} from './workouts';
import { transformMateSyncItemSchema } from './transformmate';
import { transformMateNativeItemSchema } from './transformmate-native';
export const workoutDetailSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('plan'),
    plan: workoutPlanSchema,
    workout: plannedWorkoutSchema,
    sync: transformMateSyncItemSchema.nullable(),
    sessions: z.array(workoutSessionSchema),
  }),
  z.strictObject({ kind: z.literal('session'), session: workoutSessionSchema }),
  z.strictObject({
    kind: z.literal('native'),
    item: transformMateNativeItemSchema,
  }),
  z.strictObject({
    kind: z.literal('link'),
    item: transformMateSyncItemSchema,
  }),
]);
