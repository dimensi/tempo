import { z } from 'zod';
import { workoutSchema } from './workouts';
import { transformMateSyncItemSchema } from './transformmate';
import { transformMateNativeItemSchema } from './transformmate-native';
export const workoutDetailSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('workout'),
    workout: workoutSchema,
    sync: transformMateSyncItemSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('native'),
    item: transformMateNativeItemSchema,
  }),
  z.strictObject({
    kind: z.literal('link'),
    item: transformMateSyncItemSchema,
  }),
]);
