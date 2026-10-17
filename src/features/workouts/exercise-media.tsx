'use client';
import { useState } from 'react';
import { Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import type { WorkoutExercise, WorkoutSession } from '@/contracts/workouts';
import { ExerciseDetails } from './exercise-details';
import { ExerciseVideos } from './workout-videos';
import { workoutMessages as m } from './messages';

export function ExerciseMedia({
  ownerId,
  exercise,
  session,
  canLog,
  onClose,
}: {
  ownerId: string;
  exercise: WorkoutExercise;
  session?: WorkoutSession;
  canLog: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState('technique');
  const mobile = useMediaQuery('(max-width: 48em)');
  const reduceMotion = useReducedMotion();
  const actual = session?.exercises.find((item) =>
    exercise.transformMate
      ? item.transformMate?.occurrenceKey ===
        exercise.transformMate.occurrenceKey
      : item.id === exercise.id || item.name === exercise.name,
  );
  return (
    <Modal
      opened
      onClose={onClose}
      title={exercise.name}
      fullScreen={mobile}
      size={720}
      centered
      closeButtonProps={{ 'aria-label': m.close, size: 44 }}
      transitionProps={{ duration: reduceMotion ? 0 : 180 }}
    >
      <Stack>
        <SegmentedControl
          fullWidth
          value={tab}
          onChange={setTab}
          data={[
            { value: 'technique', label: m.technique },
            { value: 'own', label: m.myVideos },
          ]}
          styles={{
            label: {
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          }}
        />
        {tab === 'technique' ? (
          exercise.transformMate ? (
            <ExerciseDetails
              ownerId={ownerId}
              exerciseId={exercise.transformMate.exerciseId}
            />
          ) : (
            <Text c="dimmed">{m.noTechnique}</Text>
          )
        ) : session && actual?.id ? (
          <ExerciseVideos
            ownerId={ownerId}
            sessionId={session.id}
            exerciseId={actual.id}
            name={actual.name}
            canUpload={canLog && session.status === 'completed'}
          />
        ) : (
          <Text c="dimmed">{m.ownVideoAfterSave}</Text>
        )}
      </Stack>
    </Modal>
  );
}
