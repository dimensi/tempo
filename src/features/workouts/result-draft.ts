import { z } from 'zod';
import { type PlannedWorkout } from '@/contracts/workouts';

export const resultDraftSchema = z
  .object({
    title: z.string().max(160),
    date: z.string().max(10),
    note: z.string().max(4000),
    status: z.enum(['in_progress', 'completed', 'skipped']),
    exercises: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            name: z.string().max(160),
            comment: z.string().max(4000).optional(),
            transformMate: z
              .object({
                exerciseId: z
                  .number()
                  .int()
                  .positive()
                  .max(Number.MAX_SAFE_INTEGER),
                occurrenceKey: z.uuid(),
              })
              .strict()
              .optional(),
            sets: z
              .array(
                z
                  .object({
                    reps: z.number().min(0).max(1000).nullable(),
                    weightKg: z.number().min(0).max(2000).nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type ResultDraft = z.infer<typeof resultDraftSchema>;
export type ResultExercise = ResultDraft['exercises'][number];
export function emptyResultDraft(
  date: string,
  workout?: PlannedWorkout,
): ResultDraft {
  return {
    title: workout?.title ?? '',
    date,
    note: '',
    status: 'completed',
    exercises:
      workout?.exercises.map((exercise) => ({
        id: crypto.randomUUID(),
        name: exercise.name,
        ...(exercise.transformMate
          ? { transformMate: structuredClone(exercise.transformMate) }
          : {}),
        sets: exercise.sets.map(() => ({ reps: null, weightKg: null })),
      })) ?? [],
  };
}
