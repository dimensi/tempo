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
  IconPlus,
  IconX,
  IconPlayerPlay,
  IconClipboardCopy,
} from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { BottomSheet } from '@/components/shared/bottom-sheet';
import { ExerciseOrder } from './exercise-order';
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
  reordering = false,
}: {
  ownerId: string;
  exercises: ResultExercise[];
  planned?: PlannedWorkout;
  session?: WorkoutSession;
  mode: 'plan' | 'result' | 'read';
  onChange?: (value: ResultExercise[]) => void;
  onCommit?: () => void;
  disabled?: boolean;
  reordering?: boolean;
}) {
  const [media, setMedia] = useState<ResultExercise | null>(null);
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [actions, setActions] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const update = (index: number, next: ResultExercise) =>
    onChange?.(exercises.map((exercise, i) => (i === index ? next : exercise)));
  if (reordering && onChange)
    return (
      <ExerciseOrder
        exercises={exercises}
        disabled={disabled}
        onChange={onChange}
      />
    );
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
        const titleParts = /^(.*?)\s*(\([^)]*\))$/.exec(exercise.name);
        const options = [
          {
            label: m.techniqueAndVideo,
            icon: <IconPlayerPlay size={20} />,
            run: () => setMedia(exercise),
          },
          {
            label: m.exerciseComment,
            run: () => setNote(note === key ? null : key),
          },
          {
            label: m.removeExercise,
            color: 'red',
            icon: <IconTrash size={20} />,
            run: () => onChange?.(exercises.filter((_, i) => i !== index)),
          },
        ];
        return (
          <section
            key={key}
            className={styles.exercise}
            aria-label={`${m.exercise}: ${exercise.name}`}
          >
            <Group gap="xs" wrap="nowrap" align="start" mb="xs">
              <UnstyledButton
                className={styles.exerciseName}
                onClick={() => setMedia(exercise)}
                aria-label={`${m.technique}: ${exercise.name}`}
              >
                <span>{titleParts?.[1] || exercise.name}</span>
                {titleParts && (
                  <span className={styles.exerciseSubtitle}>
                    {titleParts[2]}
                  </span>
                )}
                <span className={styles.techniqueLink}>
                  {m.techniqueAndVideo} ›
                </span>
              </UnstyledButton>
              {onChange &&
                (mobile ? (
                  <>
                    <ActionIcon
                      size={44}
                      variant="subtle"
                      color="gray"
                      disabled={disabled}
                      aria-label={`${m.exerciseOptions}: ${exercise.name}`}
                      onClick={() => setActions(key)}
                    >
                      <IconDots size={18} />
                    </ActionIcon>
                    <BottomSheet
                      opened={actions === key}
                      onClose={() => setActions(null)}
                      title={exercise.name}
                      closeLabel={m.close}
                    >
                      <Stack gap="xs">
                        {options.map((option) => (
                          <Button
                            key={option.label}
                            variant="default"
                            leftSection={option.icon}
                            color={option.color}
                            c={option.color ? 'red.7' : undefined}
                            justify="start"
                            mih={52}
                            disabled={disabled}
                            onClick={() => {
                              setActions(null);
                              option.run();
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </Stack>
                    </BottomSheet>
                  </>
                ) : (
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
                      {options.map((option) => (
                        <Menu.Item
                          key={option.label}
                          color={option.color}
                          disabled={disabled}
                          onClick={option.run}
                        >
                          {option.label}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                ))}
            </Group>
            {mode !== 'plan' && guide && (
              <div className={styles.planSummary}>
                <Text size="sm" fw={600}>
                  {m.prepare}
                </Text>
                <Group gap="xs" wrap="wrap">
                  {guide.sets.map((set, setIndex) => (
                    <div key={setIndex} className={styles.planSet}>
                      {guide.sets.length > 1 && (
                        <Text size="sm" c="dimmed">
                          {m.set} {setIndex + 1}
                        </Text>
                      )}
                      <Stack gap={0}>
                        <Text size="sm" c="dimmed">
                          {m.reps}
                        </Text>
                        <Text size="md" fw={600}>
                          {set.reps}
                        </Text>
                      </Stack>
                      <Stack gap={0}>
                        <Text size="sm" c="dimmed">
                          {m.weight}
                        </Text>
                        <Text size="md" fw={600}>
                          {set.weightKg === null ? m.noWeight : set.weightKg}
                        </Text>
                      </Stack>
                    </div>
                  ))}
                </Group>
              </div>
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
                      <Tooltip label={m.fillFromPlan}>
                        <ActionIcon
                          variant="subtle"
                          size={44}
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
                          <IconClipboardCopy size={20} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {exercise.sets.length > 1 && (
                      <Tooltip label={`${m.removeSet} ${setIndex + 1}`}>
                        <span className={styles.removeSet}>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size={44}
                            disabled={disabled}
                            aria-label={`${m.removeSet} ${setIndex + 1}: ${exercise.name}`}
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
                    )}
                  </div>
                ) : onChange && exercise.sets.length > 1 ? (
                  <ActionIcon
                    size={44}
                    variant="subtle"
                    color="gray"
                    disabled={disabled}
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
                variant="light"
                fullWidth
                size="sm"
                mih={44}
                mt={8}
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
