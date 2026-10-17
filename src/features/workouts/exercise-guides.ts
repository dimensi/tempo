import type { WorkoutExercise } from '@/contracts/workouts';

/** Match each planned occurrence at most once, including repeated manual names. */
export function matchExerciseGuides(
  exercises: readonly Pick<WorkoutExercise, 'name' | 'transformMate'>[],
  planned: readonly WorkoutExercise[],
) {
  const used = new Set<WorkoutExercise>();
  return exercises.map((exercise) => {
    const guide = planned.find(
      (item) =>
        !used.has(item) &&
        (exercise.transformMate
          ? item.transformMate?.occurrenceKey ===
            exercise.transformMate.occurrenceKey
          : !item.transformMate && item.name === exercise.name),
    );
    if (guide) used.add(guide);
    return guide;
  });
}
