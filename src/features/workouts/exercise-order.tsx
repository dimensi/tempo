'use client';

import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import { IconGripVertical } from '@tabler/icons-react';
import type { DraftExercise } from './workout-draft';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

function OrderRow({
  exercise,
  index,
  disabled,
}: {
  exercise: DraftExercise;
  index: number;
  disabled: boolean;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: exercise.id ?? exercise.transformMate?.occurrenceKey ?? String(index),
    index,
    disabled,
  });
  return (
    <Group
      ref={ref}
      wrap="nowrap"
      className={styles.orderRow}
      data-dragging={isDragging || undefined}
    >
      <ActionIcon
        ref={handleRef}
        variant="subtle"
        size={44}
        disabled={disabled}
        className={styles.dragHandle}
        aria-label={`${m.moveExercise}: ${exercise.name}`}
      >
        <IconGripVertical size={22} />
      </ActionIcon>
      <Text fw={600}>{exercise.name}</Text>
    </Group>
  );
}

export function ExerciseOrder({
  exercises,
  disabled,
  onChange,
}: {
  exercises: DraftExercise[];
  disabled: boolean;
  onChange: (exercises: DraftExercise[]) => void;
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled || disabled) return;
        const { source } = event.operation;
        if (!isSortable(source) || source.initialIndex === source.index) return;
        const next = [...exercises];
        const [exercise] = next.splice(source.initialIndex, 1);
        if (!exercise) return;
        next.splice(source.index, 0, exercise);
        onChange(next);
      }}
    >
      <Stack gap="xs">
        {exercises.map((exercise, index) => (
          <OrderRow
            key={exercise.id ?? exercise.transformMate?.occurrenceKey ?? index}
            exercise={exercise}
            index={index}
            disabled={disabled}
          />
        ))}
      </Stack>
    </DragDropProvider>
  );
}
