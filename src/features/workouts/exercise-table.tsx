'use client';
import { useState } from 'react';
import { Button, Group, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { WorkoutExercise } from '@/contracts/workouts';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import { actualSetForExercise } from './transformmate-exercises';
import { ExerciseDetails } from './exercise-details';
import { workoutMessages as m } from './messages';
export type ReadExercise = WorkoutExercise & { comparisonKey?: string };
export function ExerciseTable({
  exercises,
  sync,
  actual,
  factOnly = false,
  ownerId,
}: {
  exercises: ReadExercise[];
  sync?: TransformMateSyncItem;
  actual?: ReadExercise[];
  factOnly?: boolean;
  ownerId?: string;
}) {
  const [inspecting, setInspecting] = useState<number | null>(null);
  const match = (exercise: ReadExercise, index: number) =>
    exercise.comparisonKey
      ? actual?.find((entry) => entry.comparisonKey === exercise.comparisonKey)
      : exercise.transformMate
        ? actual?.find(
            (entry) =>
              entry.transformMate?.occurrenceKey ===
                exercise.transformMate?.occurrenceKey &&
              entry.transformMate?.exerciseId ===
                exercise.transformMate?.exerciseId,
          )
        : actual?.[index]?.name === exercise.name
          ? actual[index]
          : undefined;
  const represented = new Set(exercises.map(match));
  return (
    <Stack gap="md">
      {exercises.map((exercise, index) => {
        const matched = match(exercise, index);
        return (
          <Stack gap="xs" key={index}>
            <Group justify="space-between" gap="xs">
              <Text fw={600}>{exercise.name}</Text>
              {ownerId && exercise.transformMate && index !== inspecting && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  mih={44}
                  leftSection={<IconInfoCircle size={16} />}
                  aria-label={`${m.details}: ${exercise.name}`}
                  onClick={() => setInspecting(index)}
                >
                  {m.details}
                </Button>
              )}
            </Group>
            {exercise.comment && <Text size="sm">{exercise.comment}</Text>}
            {matched?.comment && matched.comment !== exercise.comment && (
              <Text size="sm">{matched.comment}</Text>
            )}
            <ScrollArea type="auto">
              <Table miw={280} style={{ tableLayout: 'fixed' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={80}>{m.set}</Table.Th>
                    <Table.Th>{factOnly ? m.reps : m.planned}</Table.Th>
                    <Table.Th>{factOnly ? m.weight : m.actual}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Array.from(
                    {
                      length: Math.max(
                        exercise.sets.length,
                        matched?.sets.length ?? 0,
                      ),
                    },
                    (_, i) => {
                      const set = exercise.sets[i];
                      const result = matched?.sets[i];
                      const remote = sync?.actual
                        ? actualSetForExercise(sync.actual, exercise, i + 1)
                        : undefined;
                      const value = (entry: WorkoutExercise['sets'][number]) =>
                        `${entry.reps} × ${entry.weightKg ?? m.noWeight}${entry.weightKg === null ? '' : ' кг'}`;
                      return (
                        <Table.Tr key={i}>
                          <Table.Td>{i + 1}</Table.Td>
                          <Table.Td>
                            {factOnly ? (
                              set?.reps
                            ) : (
                              <Text size="sm">{set ? value(set) : '—'}</Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            {factOnly ? (
                              (set?.weightKg ?? '—')
                            ) : result ? (
                              <Text size="sm">{value(result)}</Text>
                            ) : remote ? (
                              <Stack gap={2}>
                                <Text size="sm" fw={600}>
                                  {remote.done ? m.done : m.notDone}
                                </Text>
                                {remote.metrics.map((metric, metricIndex) => (
                                  <Text size="sm" key={metricIndex}>
                                    {metric.name}:{' '}
                                    {metric.values.length
                                      ? metric.values.join(' / ')
                                      : '—'}{' '}
                                    {metric.unit}
                                  </Text>
                                ))}
                              </Stack>
                            ) : (
                              '—'
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    },
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            {ownerId && exercise.transformMate && index === inspecting && (
              <ExerciseDetails
                key={`${ownerId}-${exercise.transformMate!.exerciseId}`}
                ownerId={ownerId}
                exerciseId={exercise.transformMate!.exerciseId}
              />
            )}
          </Stack>
        );
      })}
      {actual
        ?.filter((exercise) => !represented.has(exercise))
        .map((exercise, index) => (
          <ExerciseTable
            key={`actual-${index}`}
            exercises={[exercise]}
            factOnly
            ownerId={ownerId}
          />
        ))}
    </Stack>
  );
}
