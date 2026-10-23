import { z } from 'zod';
import {
  workoutSetSchema,
  workoutInputSchema,
  workoutFatigueSchema,
  workoutFailureSchema,
  type WorkoutInput,
} from '@/contracts/workouts';

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
            fatigue: workoutFatigueSchema.optional(),
            failure: workoutFailureSchema.optional(),
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
                    lastValid: workoutSetSchema.nullable().optional(),
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
export function rememberValidSets(draft: WorkoutDraft): WorkoutDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const parsed = workoutSetSchema.safeParse({
          reps: set.reps,
          weightKg: set.weightKg,
        });
        return parsed.success ? { ...set, lastValid: parsed.data } : set;
      }),
    })),
  };
}
export function projectWorkoutDraft(
  draft: WorkoutDraft,
  partial: boolean,
  baseline?: WorkoutInput,
) {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) => {
      const prior = baseline?.exercises.find((item) => item.id === exercise.id);
      const legacyPartial =
        partial &&
        prior &&
        exercise.sets.some(
          (set) =>
            set.lastValid === undefined &&
            !workoutSetSchema.safeParse({
              reps: set.reps,
              weightKg: set.weightKg,
            }).success,
        );
      return {
        ...exercise,
        sets: legacyPartial
          ? prior.sets
          : exercise.sets.flatMap((set) => {
              const value = { reps: set.reps, weightKg: set.weightKg };
              const parsed = workoutSetSchema.safeParse(value);
              if (parsed.success) return [parsed.data];
              return partial ? (set.lastValid ? [set.lastValid] : []) : [value];
            }),
      };
    }),
  };
}
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

/** Distinguish assessment-only input from changed sets, text, order or lifecycle. */
export function isFeedbackOnlyChange(
  draft: WorkoutDraft,
  baseline: WorkoutInput,
) {
  const parsed = workoutInputSchema.safeParse(
    projectWorkoutDraft(draft, false),
  );
  if (!parsed.success) return false;
  const content = (value: WorkoutInput) => ({
    date: value.date,
    title: value.title,
    note: value.note,
    status: value.status,
    exercises: value.exercises.map(
      ({ id, name, comment, transformMate, sets }) => ({
        id,
        name,
        comment,
        transformMate,
        sets,
      }),
    ),
  });
  return (
    JSON.stringify(content(parsed.data)) === JSON.stringify(content(baseline))
  );
}
