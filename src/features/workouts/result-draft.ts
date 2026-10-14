import { z } from 'zod';
import {
  workoutSessionInputSchema,
  type WorkoutSessionInput,
  type PlannedWorkout,
} from '@/contracts/workouts';

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
export function resultDraftInput(draft: ResultDraft): {
  data: WorkoutSessionInput | null;
  error: 'reps' | 'exercise' | 'validation' | null;
} {
  if (draft.status === 'completed' && !draft.exercises.length)
    return { data: null, error: 'exercise' };
  const untouched = draft.exercises.every(
    (exercise) =>
      !exercise.comment?.trim() &&
      exercise.sets.every((set) => set.reps === null && set.weightKg === null),
  );
  const value =
    untouched && draft.status !== 'completed'
      ? { ...draft, exercises: [] }
      : draft;
  if (
    value.exercises.some((exercise) =>
      exercise.sets.some(
        (set) =>
          set.reps === null || !Number.isInteger(set.reps) || set.reps < 1,
      ),
    )
  )
    return { data: null, error: 'reps' };
  const parsed = workoutSessionInputSchema.safeParse(value);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: 'validation' };
}
