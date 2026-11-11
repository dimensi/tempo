import type { TransformMateSyncItem } from '@/contracts/transformmate';
import { Stack, Text } from '@mantine/core';
import { NativeWorkout, type NativeWorkoutReadItem } from './native-workout';
import { WorkoutSync } from './transformmate-sync';
import { workoutMessages as m } from './messages';

/** A deleted local plan leaves a read-only provider workout, not a sync debug view. */
export function LinkedWorkout({
  item,
  ownerId,
}: {
  item: TransformMateSyncItem;
  ownerId: string;
}) {
  const plan = (item.publishedSnapshot ?? item.planSnapshot).workout;
  const actual = item.actual;
  const exercises: NativeWorkoutReadItem['exercises'] = plan.exercises.map(
    (exercise, index) => {
      const fact = actual?.exercises.find(
        (entry) =>
          exercise.transformMate &&
          entry.occurrenceKey === exercise.transformMate.occurrenceKey &&
          entry.exerciseId === exercise.transformMate.exerciseId,
      );
      return {
        protocolOrder: 1,
        order: index + 1,
        exerciseId: exercise.transformMate?.exerciseId,
        name: fact?.name ?? exercise.name,
        comment: fact?.comment ?? exercise.comment ?? '',
        metrics: [
          {
            type: 'plan',
            sets: exercise.sets.map((set, order) => ({
              order: order + 1,
              done: null,
              metrics: [
                {
                  name: m.reps,
                  unit: '',
                  type: 'reps',
                  values: [String(set.reps)],
                },
                ...(set.weightKg == null
                  ? []
                  : [
                      {
                        name: m.weight,
                        unit: '',
                        type: 'weight',
                        values: [String(set.weightKg)],
                      },
                    ]),
              ],
            })),
          },
          { type: 'fact', sets: fact?.sets ?? [] },
        ],
      };
    },
  );
  for (const [index, exercise] of (actual?.exercises ?? []).entries()) {
    if (
      plan.exercises.some(
        (planned) =>
          planned.transformMate &&
          planned.transformMate.occurrenceKey === exercise.occurrenceKey &&
          planned.transformMate.exerciseId === exercise.exerciseId,
      )
    )
      continue;
    exercises.push({
      protocolOrder: 2,
      order: index + 1,
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      comment: exercise.comment,
      metrics: [{ type: 'fact', sets: exercise.sets }],
    });
  }
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {m.deletedLocalWorkout}
      </Text>
      <NativeWorkout
        ownerId={ownerId}
        item={{
          source: 'transformmate',
          remoteTrainingId: item.remoteTrainingId ?? undefined,
          date: actual?.date ?? plan.date,
          title: actual?.title ?? plan.title,
          progress: '',
          started: actual?.started ?? null,
          finished: actual?.finished ?? null,
          exercises,
        }}
      />
      <WorkoutSync item={item} showActual={false} />
    </Stack>
  );
}
