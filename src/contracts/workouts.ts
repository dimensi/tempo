import { z } from 'zod';

const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(160);
const weight = z.number().min(0).max(2000).nullable();
export const workoutSetSchema = z
  .object({
    reps: z.number().int().min(1).max(1000),
    weightKg: weight,
  })
  .strict();
export const workoutExerciseSchema = z
  .object({
    name,
    comment: z.string().trim().max(4000).optional(),
    transformMate: z
      .object({
        exerciseId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        occurrenceKey: z.uuid(),
      })
      .strict()
      .optional(),
    sets: z.array(workoutSetSchema).min(1).max(50),
  })
  .strict();
export const plannedWorkoutSchema = z
  .object({
    id,
    date: z.iso.date(),
    title: name,
    exercises: z.array(workoutExerciseSchema).min(1).max(50),
  })
  .strict();
export const workoutPlanInputSchema = z
  .object({
    title: name,
    description: z.string().trim().max(4000),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    workouts: z.array(plannedWorkoutSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endsOn < value.startsOn)
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'invalid range',
      });
    const ids = new Set<string>();
    value.workouts.forEach((workout, index) => {
      const occurrences = new Set<string>();
      workout.exercises.forEach((exercise, exerciseIndex) => {
        const key = exercise.transformMate?.occurrenceKey;
        if (key && occurrences.has(key))
          ctx.addIssue({
            code: 'custom',
            path: [
              'workouts',
              index,
              'exercises',
              exerciseIndex,
              'transformMate',
            ],
            message: 'duplicate exercise occurrence',
          });
        if (key) occurrences.add(key);
      });
      if (workout.date < value.startsOn || workout.date > value.endsOn)
        ctx.addIssue({
          code: 'custom',
          path: ['workouts', index, 'date'],
          message: 'outside plan range',
        });
      if (ids.has(workout.id))
        ctx.addIssue({
          code: 'custom',
          path: ['workouts', index, 'id'],
          message: 'duplicate workout',
        });
      ids.add(workout.id);
    });
  });
export const workoutSessionInputSchema = z
  .object({
    date: z.iso.date(),
    title: name,
    exercises: z.array(workoutExerciseSchema).max(50),
    note: z.string().trim().max(4000),
    status: z.enum(['in_progress', 'completed', 'skipped']),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'completed' && value.exercises.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'completed requires exercises',
      });
  });
export const workoutPlanSchema = workoutPlanInputSchema.safeExtend({
  id,
  ownerId: id,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workoutSessionSchema = workoutSessionInputSchema.safeExtend({
  id,
  ownerId: id,
  revision: z.number().int().positive(),
  planId: id.nullable(),
  plannedWorkoutId: id.nullable(),
  planSnapshot: z
    .object({ planTitle: name, workout: plannedWorkoutSchema })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const sessionCreateSchema = workoutSessionInputSchema
  .safeExtend({
    planId: id.optional(),
    plannedWorkoutId: id.optional(),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.planId) !== Boolean(value.plannedWorkoutId))
      ctx.addIssue({
        code: 'custom',
        path: ['planId'],
        message: 'both references required',
      });
  });
export const revisionSchema = z.number().int().positive();
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type PlannedWorkout = z.infer<typeof plannedWorkoutSchema>;
export type WorkoutPlanInput = z.infer<typeof workoutPlanInputSchema>;
export type WorkoutPlan = z.infer<typeof workoutPlanSchema>;
export type WorkoutSessionInput = z.infer<typeof workoutSessionInputSchema>;
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
export type WorkoutSessionCreate = z.infer<typeof sessionCreateSchema>;
export interface WorkoutsData {
  contractVersion: 1;
  source: 'user';
  plans: WorkoutPlan[];
  sessions: WorkoutSession[];
}
