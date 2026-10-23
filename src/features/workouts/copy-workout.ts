import type { WorkoutInput } from '@/contracts/workouts';
export function copyWorkoutToDate(
  workout: WorkoutInput,
  date: string,
): WorkoutInput {
  return {
    date,
    title: workout.title,
    note: workout.note,
    status: 'planned',
    exercises: workout.exercises.map((exercise) => ({
      ...structuredClone(exercise),
      id: crypto.randomUUID(),
      ...(exercise.transformMate
        ? {
            transformMate: {
              ...exercise.transformMate,
              occurrenceKey: crypto.randomUUID(),
            },
          }
        : {}),
    })),
  };
}
