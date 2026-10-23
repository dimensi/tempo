import { z } from 'zod';

const id = z.string().min(1).max(128);
const title = z.string().trim().max(160);
import { workoutExerciseSchema } from './workouts';
export const publicationWorkoutSchema = z
  .object({
    id,
    date: z.iso.date(),
    title,
    // Local occurrence IDs are not part of a provider publication fingerprint.
    exercises: z
      .array(
        workoutExerciseSchema
          .omit({ id: true, fatigue: true, failure: true })
          .strip(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const workoutPublicationInputSchema = z
  .object({
    title,
    description: z.string().trim().max(4000),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    workouts: z.array(publicationWorkoutSchema).min(1).max(100),
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

export const workoutPublicationSchema =
  workoutPublicationInputSchema.safeExtend({
    id,
    ownerId: id,
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });
export type PublicationWorkout = z.infer<typeof publicationWorkoutSchema>;
export type WorkoutPublication = z.infer<typeof workoutPublicationSchema>;
