'use client';
import { useState } from 'react';
import { Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { useMediaQuery, useReducedMotion } from '@mantine/hooks';
import type { WorkoutExercise, Workout } from '@/contracts/workouts';
import { ExerciseDetails } from './exercise-details';
import { ExerciseVideos } from './workout-videos';
import { workoutMessages as m } from './messages';

export function ExerciseMedia({
  opened = true,
  ownerId,
  exercise,
  actual,
  session,
  canLog,
  onClose,
  initialTab = 'technique',
  onVideosChange,
}: {
  opened?: boolean;
  ownerId: string;
  exercise: WorkoutExercise;
  actual?: WorkoutExercise;
  session?: Workout;
  canLog: boolean;
  onClose: () => void;
  initialTab?: 'technique' | 'own';
  onVideosChange?: (exerciseId: string, hasVideos: boolean) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [ownVisited, setOwnVisited] = useState(initialTab === 'own');
  const [wasOpened, setWasOpened] = useState(opened);
  // Reset the selected tab on reopening without remounting the upload queue.
  if (wasOpened !== opened) {
    setWasOpened(opened);
    if (opened) {
      setTab(initialTab);
      if (initialTab === 'own') setOwnVisited(true);
    }
  }
  const mobile = useMediaQuery('(max-width: 48em)');
  const reduceMotion = useReducedMotion();
  return (
    <Modal
      opened={opened}
      keepMounted
      keepMountedMode="display-none"
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
          onChange={(value) => {
            setTab(value as 'technique' | 'own');
            if (value === 'own') setOwnVisited(true);
          }}
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
        {opened &&
          tab === 'technique' &&
          (exercise.transformMate ? (
            <ExerciseDetails
              ownerId={ownerId}
              exerciseId={exercise.transformMate.exerciseId}
            />
          ) : (
            <Text c="dimmed">{m.noTechnique}</Text>
          ))}
        {(ownVisited || (opened && tab === 'own')) && (
          <div hidden={!opened || tab !== 'own'}>
            {session && actual?.id ? (
              <ExerciseVideos
                ownerId={ownerId}
                sessionId={session.id}
                exerciseId={actual.id}
                name={actual.name}
                visible={opened && tab === 'own'}
                onVideosChange={onVideosChange}
                canUpload={
                  canLog &&
                  (session.status === 'in_progress' ||
                    session.status === 'completed')
                }
              />
            ) : (
              <Text c="dimmed">{m.ownVideoAfterSave}</Text>
            )}
          </div>
        )}
      </Stack>
    </Modal>
  );
}
