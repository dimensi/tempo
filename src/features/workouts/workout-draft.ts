import { z } from 'zod';
import type { WorkoutInput } from '@/contracts/workouts';

export const workoutDraftSchema = z
  .object({
    title: z.string().max(160),
    date: z.string().max(10),
    note: z.string().max(12000),
    status: z.enum(['planned', 'in_progress', 'completed']),
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
                    reps: z.union([z.number(), z.string()]).nullable(),
                    weightKg: z.union([z.number(), z.string()]).nullable(),
                  })
                  .strict(),
              )
              .max(50),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type WorkoutDraft = z.infer<typeof workoutDraftSchema>;
export type DraftExercise = WorkoutDraft['exercises'][number];
export function emptyWorkoutDraft(
  date: string,
  workout?: WorkoutInput,
): WorkoutDraft {
  return {
    title: workout?.title ?? '',
    date,
    note: workout?.note ?? '',
    status: 'planned',
    exercises:
      workout?.exercises.map((exercise) => ({
        id: crypto.randomUUID(),
        name: exercise.name,
        ...(exercise.transformMate
          ? { transformMate: structuredClone(exercise.transformMate) }
          : {}),
        comment: exercise.comment,
        sets: structuredClone(exercise.sets),
      })) ?? [],
  };
}
