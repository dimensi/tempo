import 'server-only';
import type { Workout } from '@/contracts/workouts';
import type { WorkoutPublication } from '@/contracts/workout-publication';

export function canPublish(workout: Workout): boolean {
  return (
    workout.status === 'planned' &&
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
        exercises: workout.exercises,
      },
    ],
  };
}
