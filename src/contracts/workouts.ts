import { z } from 'zod';

const id = z.string().min(1).max(128);
export const workoutSetSchema = z.strictObject({
  reps: z.number().int().min(1).max(1000),
  weightKg: z.number().min(0).max(2000).nullable(),
});
export const workoutExerciseSchema = z.strictObject({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(160),
  comment: z.string().trim().max(4000).optional(),
  transformMate: z
    .strictObject({
      exerciseId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      occurrenceKey: z.uuid(),
    })
    .optional(),
  // Empty existing occurrences retain their identity and attached personal media.
  sets: z.array(workoutSetSchema).max(50),
});
export const workoutStatusSchema = z.enum([
  'planned',
  'in_progress',
  'completed',
]);
export const workoutActionSchema = z.enum(['start', 'complete', 'resume']);
export const workoutInputSchema = z
  .strictObject({
    date: z.iso.date(),
    title: z.string().trim().max(160),
    exercises: z.array(workoutExerciseSchema).max(50),
    note: z.string().trim().max(12000),
    status: workoutStatusSchema,
  })
  .superRefine((value, ctx) => {
    const ids = value.exercises.flatMap((e) => (e.id ? [e.id] : []));
    const keys = value.exercises.flatMap((e) =>
      e.transformMate ? [e.transformMate.occurrenceKey] : [],
    );
    if (new Set(ids).size !== ids.length || new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'duplicate exercise occurrence',
      });
  });
export const workoutSchema = workoutInputSchema.safeExtend({
  id,
  ownerId: id,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const revisionSchema = z.number().int().positive();
export const workoutMutationSchema = z.strictObject({
  data: workoutInputSchema,
  action: workoutActionSchema.optional(),
});
export const workoutsDataSchema = z.strictObject({
  contractVersion: z.literal(2),
  source: z.literal('user'),
  workouts: z.array(workoutSchema),
});
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type WorkoutStatus = z.infer<typeof workoutStatusSchema>;
export type WorkoutAction = z.infer<typeof workoutActionSchema>;
export type WorkoutInput = z.infer<typeof workoutInputSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type WorkoutMutation = z.infer<typeof workoutMutationSchema>;
export type WorkoutsData = z.infer<typeof workoutsDataSchema>;
