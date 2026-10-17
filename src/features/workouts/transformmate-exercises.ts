import type {
  TransformMateActual,
  TransformMateCatalogItem,
} from '@/contracts/transformmate';
import type { WorkoutExercise } from '@/contracts/workouts';

export function selectCatalogExercise<
  T extends Pick<WorkoutExercise, 'name' | 'transformMate'>,
>(
  exercise: T,
  item: TransformMateCatalogItem,
): T & Pick<WorkoutExercise, 'name' | 'transformMate'> {
  return {
    ...exercise,
    name: item.name,
    transformMate: {
      exerciseId: item.id,
      occurrenceKey:
        exercise.transformMate?.exerciseId === item.id
          ? exercise.transformMate.occurrenceKey
          : crypto.randomUUID(),
    },
  };
}

export function actualSetForExercise(
  actual: TransformMateActual | null,
  exercise: WorkoutExercise,
  order: number,
) {
  const link = exercise.transformMate;
  if (!link) return undefined;
  return actual?.exercises
    .find(
      (item) =>
        item.occurrenceKey === link.occurrenceKey &&
        item.exerciseId === link.exerciseId,
    )
    ?.sets.find((set) => set.order === order);
}

export const techniqueHref = (ownerId: string, id: number) =>
  `/api/workouts/transformmate/exercises/${id}/video?ownerId=${encodeURIComponent(ownerId)}`;
export const exerciseHref = (ownerId: string, id: number) =>
  `/api/workouts/transformmate/exercises/${id}?ownerId=${encodeURIComponent(ownerId)}`;
