import 'server-only';
import type { Workout } from '@/contracts/workouts';
import type { WorkoutPublication } from '@/contracts/workout-publication';

export function canPublish(workout: Workout): boolean {
  return (
    workout.exercises.length > 0 &&
    workout.exercises.every((exercise) => exercise.sets.length > 0)
  );
}

/** A provider transport snapshot; the local workout remains the only entity. */
export function publicationFor(workout: Workout): WorkoutPublication {
  return {
    id: workout.id,
    ownerId: workout.ownerId,
    revision: workout.revision,
    createdAt: workout.createdAt,
    updatedAt: workout.updatedAt,
    title: workout.title,
    description: workout.note,
    startsOn: workout.date,
    endsOn: workout.date,
    workouts: [
      {
        id: workout.id,
        date: workout.date,
        title: workout.title,
        exercises: workout.exercises.map(
          ({ name, comment, transformMate, sets }) => ({
            name,
            comment,
            transformMate,
            sets,
          }),
        ),
      },
    ],
  };
}

/** Old records did not retain lifecycle times. Mark repair timestamps as unknown history. */
export function workoutLifecycle(
  workout: Workout,
  previous?: import('./state').SyncState['lifecycle'],
) {
  if (previous?.status === workout.status) return previous;
  const at = previous ? workout.updatedAt : new Date().toISOString();
  return {
    status: workout.status,
    startedAt:
      workout.status === 'planned' ? null : (previous?.startedAt ?? at),
    finishedAt: workout.status === 'completed' ? at : null,
    historicalTimeUnknown:
      previous?.historicalTimeUnknown ?? workout.status !== 'planned',
  };
}
