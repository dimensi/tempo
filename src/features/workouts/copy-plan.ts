import type { WorkoutPlanInput } from '@/contracts/workouts';
const day = 86_400_000;
export function copyPlanToDate(
  plan: WorkoutPlanInput,
  startsOn: string,
): WorkoutPlanInput {
  const delta =
    (Date.parse(`${startsOn}T00:00:00Z`) -
      Date.parse(`${plan.startsOn}T00:00:00Z`)) /
    day;
  const shift = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + delta * day)
      .toISOString()
      .slice(0, 10);
  return {
    ...structuredClone(plan),
    startsOn,
    endsOn: shift(plan.endsOn),
    workouts: plan.workouts.map((workout) => ({
      ...structuredClone(workout),
      id: crypto.randomUUID(),
      date: shift(workout.date),
      exercises: workout.exercises.map((exercise) => ({
        ...structuredClone(exercise),
        id: crypto.randomUUID(),
        ...(exercise.transformMate
          ? {
              transformMate: {
                exerciseId: exercise.transformMate.exerciseId,
                occurrenceKey: crypto.randomUUID(),
              },
            }
          : {}),
      })),
    })),
  };
}
