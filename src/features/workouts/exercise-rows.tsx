'use client';
import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  NumberInput,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconDots,
  IconTrash,
  IconPlayerPlay,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import type { PlannedWorkout, WorkoutSession } from '@/contracts/workouts';
import type { ResultExercise } from './result-draft';
import { ExerciseMedia } from './exercise-media';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

export function ExerciseRows({
  ownerId,
  exercises,
  planned,
  session,
  mode,
  onChange,
  onCommit,
  disabled = false,
}: {
  ownerId: string;
  exercises: ResultExercise[];
  planned?: PlannedWorkout;
  session?: WorkoutSession;
  mode: 'plan' | 'result' | 'read';
  onChange?: (value: ResultExercise[]) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const [media, setMedia] = useState<ResultExercise | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const update = (index: number, next: ResultExercise) =>
    onChange?.(exercises.map((exercise, i) => (i === index ? next : exercise)));
  return (
    <Stack gap={0}>
      {exercises.map((exercise, index) => {
        const key =
          exercise.id ?? exercise.transformMate?.occurrenceKey ?? `${index}`;
        const guide = exercise.transformMate
          ? planned?.exercises.find(
              (item) =>
                item.transformMate?.occurrenceKey ===
                exercise.transformMate?.occurrenceKey,
            )
          : planned?.exercises.find((item) => item.name === exercise.name);
        return (
          <section
            key={key}
            className={styles.exercise}
            aria-label={`${m.exercise}: ${exercise.name}`}
          >
            <Group gap="xs" wrap="nowrap" align="start" mb="xs">
              <Text className={styles.ordinal}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <UnstyledButton
                className={styles.exerciseName}
                onClick={() => setMedia(exercise)}
                aria-label={`${m.technique}: ${exercise.name}`}
              >
                <span>{exercise.name}</span>
                <IconPlayerPlay size={18} aria-hidden />
              </UnstyledButton>
              {onChange && (
                <Menu position="bottom-end">
                  <Menu.Target>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="gray"
                      disabled={disabled}
                      aria-label={`${m.exerciseOptions}: ${exercise.name}`}
                    >
                      <IconDots size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      onClick={() => setNote(note === key ? null : key)}
                    >
                      {m.exerciseComment}
                    </Menu.Item>
                    <Menu.Item
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...exercises];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        onChange(next);
                      }}
                    >
                      {m.up}
                    </Menu.Item>
                    <Menu.Item
                      disabled={index === exercises.length - 1}
                      onClick={() => {
                        const next = [...exercises];
                        [next[index + 1], next[index]] = [
                          next[index]!,
                          next[index + 1]!,
                        ];
                        onChange(next);
                      }}
                    >
                      {m.down}
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      onClick={() =>
                        onChange(exercises.filter((_, i) => i !== index))
                      }
                    >
                      {m.removeExercise}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
            {mode !== 'plan' && guide && (
              <Text size="sm" c="dimmed" mb="xs">
                {m.planGuide}:{' '}
                {guide.sets
                  .map(
                    (set) =>
                      `${set.reps} ${m.resultReps} · ${set.weightKg === null ? m.noWeight : `${set.weightKg} ${m.resultWeight}`}`,
                  )
                  .join(' · ')}
              </Text>
            )}
            {mode === 'result' && (
              <Text size="sm" fw={600} mb={4}>
                {m.actualSets}
              </Text>
            )}
            <div
              className={`${styles.setHeading} ${mode === 'result' && onChange ? styles.withSetActions : ''}`}
              aria-hidden
            >
              <span>{m.setNumber}</span>
              <span>{m.weight}</span>
              <span>{m.reps}</span>
              {!(mode === 'result' && onChange) && <span />}
            </div>
            {exercise.sets.map((set, setIndex) => (
              <div
                key={setIndex}
                className={`${styles.setRow} ${mode === 'result' && onChange ? styles.withSetActions : ''}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    onCommit?.();
                }}
              >
                <Text size="sm" c="dimmed">
                  {setIndex + 1}
                </Text>
                {mode === 'read' ? (
                  <>
                    <Text>{set.weightKg ?? m.noWeight}</Text>
                    <Text>{set.reps ?? '—'}</Text>
                  </>
                ) : (
                  <>
                    <NumberInput
                      aria-label={`${exercise.name}, ${m.set} ${setIndex + 1}, ${m.weight}`}
                      hideControls
                      inputMode="decimal"
                      placeholder={m.noWeight}
                      value={set.weightKg ?? ''}
                      min={0}
                      max={2000}
                      decimalScale={2}
                      disabled={disabled}
                      onChange={(value) =>
                        update(index, {
                          ...exercise,
                          sets: exercise.sets.map((row, i) =>
                            i === setIndex
                              ? {
                                  ...row,
                                  weightKg:
                                    typeof value === 'number' ? value : null,
                                }
                              : row,
                          ),
                        })
                      }
                    />
                    <NumberInput
                      aria-label={`${exercise.name}, ${m.set} ${setIndex + 1}, ${m.reps}`}
                      hideControls
                      inputMode="numeric"
                      placeholder={
                        mode === 'result'
                          ? String(guide?.sets[setIndex]?.reps ?? '—')
                          : '10'
                      }
                      value={set.reps ?? ''}
                      min={1}
                      max={1000}
                      allowDecimal={false}
                      disabled={disabled}
                      onChange={(value) =>
                        update(index, {
                          ...exercise,
                          sets: exercise.sets.map((row, i) =>
                            i === setIndex
                              ? {
                                  ...row,
                                  reps:
                                    typeof value === 'number' ? value : null,
                                }
                              : row,
                          ),
                        })
                      }
                    />
                  </>
                )}
                {mode === 'result' && onChange ? (
                  <div className={styles.setActions}>
                    {guide?.sets[setIndex] && (
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        mih={44}
                        disabled={disabled}
                        aria-label={`${m.fillFromPlan}, ${m.set} ${setIndex + 1}: ${exercise.name}`}
                        onClick={() =>
                          update(index, {
                            ...exercise,
                            sets: exercise.sets.map((row, i) =>
                              i === setIndex
                                ? { ...guide.sets[setIndex]! }
                                : row,
                            ),
                          })
                        }
                      >
                        {m.planGuide}
                      </Button>
                    )}
                    <Tooltip
                      label={
                        exercise.sets.length === 1
                          ? m.lastSetHint
                          : `${m.removeSet} ${setIndex + 1}`
                      }
                    >
                      <span className={styles.removeSet}>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size={44}
                          disabled={disabled || exercise.sets.length === 1}
                          aria-label={`${m.removeSet} ${setIndex + 1}: ${exercise.name}`}
                          aria-description={
                            exercise.sets.length === 1
                              ? m.lastSetHint
                              : undefined
                          }
                          onClick={() =>
                            update(index, {
                              ...exercise,
                              sets: exercise.sets.filter(
                                (_, i) => i !== setIndex,
                              ),
                            })
                          }
                        >
                          <IconTrash size={18} />
                        </ActionIcon>
                      </span>
                    </Tooltip>
                  </div>
                ) : onChange ? (
                  <ActionIcon
                    size={44}
                    variant="subtle"
                    color="gray"
                    disabled={disabled || exercise.sets.length === 1}
                    aria-label={`${m.removeSet} ${setIndex + 1}: ${exercise.name}`}
                    onClick={() =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.filter((_, i) => i !== setIndex),
                      })
                    }
                  >
                    <IconX size={16} />
                  </ActionIcon>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {onChange && (
              <Button
                variant="subtle"
                size="compact-sm"
                mih={44}
                mt={4}
                leftSection={<IconPlus size={15} />}
                disabled={disabled || exercise.sets.length >= 50}
                onClick={() =>
                  update(index, {
                    ...exercise,
                    sets: [
                      ...exercise.sets,
                      mode === 'plan'
                        ? {
                            ...exercise.sets.at(-1)!,
                            reps: exercise.sets.at(-1)?.reps ?? 10,
                          }
                        : { reps: null, weightKg: null },
                    ],
                  })
                }
              >
                {m.addSet}
              </Button>
            )}
            {note === key ? (
              <Textarea
                label={m.exerciseComment}
                value={exercise.comment ?? ''}
                maxLength={4000}
                autosize
                disabled={disabled}
                onChange={(e) =>
                  update(index, { ...exercise, comment: e.currentTarget.value })
                }
                onBlur={onCommit}
              />
            ) : (
              exercise.comment && (
                <Text size="sm" c="dimmed" mt="xs">
                  {exercise.comment}
                </Text>
              )
            )}
          </section>
        );
      })}
      {media && (
        <ExerciseMedia
          ownerId={ownerId}
          exercise={{
            ...media,
            sets: media.sets.map((set) => ({ ...set, reps: set.reps ?? 1 })),
          }}
          session={session}
          canLog={mode !== 'read'}
          onClose={() => setMedia(null)}
        />
      )}
    </Stack>
  );
}
