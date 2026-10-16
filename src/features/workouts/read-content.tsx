'use client';
import { Stack, Text, Title } from '@mantine/core';
import { ExerciseTable } from './exercise-table';
import { NativeWorkout, type NativeWorkoutReadItem } from './native-workout';
import { workoutMessages as m } from './messages';
import type { WorkoutExercise } from '@/contracts/workouts';
import type { TransformMateSyncItem } from '@/contracts/transformmate';
import type { ReactNode } from 'react';
export type WorkoutReadContentProps =
  | {
      kind: 'plan';
      sync?: TransformMateSyncItem;
      description: string;
      exercises: WorkoutExercise[];
      sessions: { key: string; exercises: WorkoutExercise[]; note: string }[];
      comments?: (key: string) => ReactNode;
      ownerId?: string;
    }
  | {
      kind: 'session';
      showStatus?: boolean;
      status: 'in_progress' | 'completed' | 'skipped';
      exercises: WorkoutExercise[];
      snapshot: { title: string; exercises: WorkoutExercise[] } | null;
      note: string;
      comments?: ReactNode;
      ownerId?: string;
    }
  | { kind: 'native'; item: NativeWorkoutReadItem; ownerId?: string };
export function WorkoutReadContent(props: WorkoutReadContentProps) {
  if (props.kind === 'native')
    return <NativeWorkout item={props.item} ownerId={props.ownerId} fullView />;
  if (props.kind === 'plan')
    return (
      <>
        {props.description && (
          <Text style={{ whiteSpace: 'pre-wrap' }}>{props.description}</Text>
        )}
        <ExerciseTable
          ownerId={props.ownerId}
          exercises={props.exercises}
          sync={props.sync}
          actual={props.sessions.at(-1)?.exercises}
        />
        {props.sessions.map((result, index) => (
          <Stack key={result.key} data-testid={`session-${result.key}`}>
            <Title order={2} size="h3">
              {m.actualDetails}
            </Title>
            {index !== props.sessions.length - 1 && (
              <ExerciseTable
                exercises={result.exercises}
                factOnly
                ownerId={props.ownerId}
              />
            )}
            {result.note && <Text>{result.note}</Text>}
            {props.comments?.(result.key)}
          </Stack>
        ))}
      </>
    );
  if (props.kind === 'session')
    return (
      <>
        {props.showStatus !== false && (
          <Text size="sm" c="dimmed">
            {m[props.status]}
          </Text>
        )}
        {!props.exercises.length && (
          <Text size="sm" c="dimmed">
            {m.noActualRecorded}
          </Text>
        )}
        {props.snapshot ? (
          <>
            <Title order={2} size="h3">
              {m.snapshot}
            </Title>
            <ExerciseTable
              ownerId={props.ownerId}
              exercises={props.snapshot.exercises}
              actual={props.exercises}
            />
          </>
        ) : (
          <ExerciseTable
            ownerId={props.ownerId}
            exercises={props.exercises}
            factOnly
          />
        )}
        {props.note && (
          <Text style={{ whiteSpace: 'pre-wrap' }}>{props.note}</Text>
        )}
        {props.comments}
      </>
    );
  return null;
}
