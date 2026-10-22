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
import { useReadOnline } from '@/lib/use-read-online';
import { ExerciseOrder } from './exercise-order';
import { matchExerciseGuides } from './exercise-guides';
import type {
  PlannedWorkout,
  WorkoutExercise,
  WorkoutSession,
} from '@/contracts/workouts';
import type { ResultExercise } from './result-draft';
import { ExerciseMedia } from './exercise-media';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

export function ExerciseRows({
  ownerId,
  canLog,
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
  canLog: boolean;
  exercises: ResultExercise[];
  planned?: PlannedWorkout;
  session?: WorkoutSession;
  mode: 'plan' | 'result' | 'read';
  onChange?: (value: ResultExercise[]) => void;
  onCommit?: () => void;
  disabled?: boolean;
  reordering?: boolean;
}) {
  const [media, setMedia] = useState<{
    exercise: ResultExercise;
    actual?: WorkoutExercise;
  } | null>(null);
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [actions, setActions] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const online = useReadOnline();
  const guides = matchExerciseGuides(exercises, planned?.exercises ?? []);
  const recorded =
    mode === 'plan'
      ? matchExerciseGuides(exercises, session?.exercises ?? [])
      : exercises.map((exercise) =>
          session?.exercises.find(
            (item) => Boolean(exercise.id) && item.id === exercise.id,
          ),
        );
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
        const guide = guides[index];
        const openMedia = () => setMedia({ exercise, actual: recorded[index] });
        const titleParts = /^(.*?)\s*(\([^)]*\))$/.exec(exercise.name);
        const completed = exercise.sets.filter(
          (set) => set.reps !== null && set.reps > 0,
        ).length;
        const existingOccurrence = Boolean(
          session &&
            exercise.id &&
            session.exercises.some((item) => item.id === exercise.id),
        );
        const lockedRemoval =
          mode === 'result' && existingOccurrence && !online;
        const options = [
          {
            label: m.techniqueAndVideo,
            icon: <IconPlayerPlay size={20} />,
            disabled,
            run: openMedia,
          },
          {
            label: m.exerciseComment,
            disabled,
            run: () => setNote(note === key ? null : key),
          },
          {
            label: m.removeExercise,
            color: 'red',
            icon: <IconTrash size={20} />,
            disabled: disabled || lockedRemoval,
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
                onClick={openMedia}
                aria-label={`${m.technique}: ${exercise.name}`}
              >
                <span>{titleParts?.[1] || exercise.name}</span>
                {titleParts && (
                  <span className={styles.exerciseSubtitle}>
                    {titleParts[2]}
                  </span>
                )}
                <span className={styles.exerciseAssist}>
                  <span className={styles.techniqueLink}>
                    {m.techniqueAndVideo} ›
                  </span>
                  {mode !== 'plan' && exercise.sets.length > 0 && (
                    <span className={styles.exerciseCount}>
                      {completed} / {exercise.sets.length} {m.shortSets}
                    </span>
                  )}
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
                            disabled={option.disabled}
                            onClick={() => {
                              setActions(null);
                              option.run();
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                        {lockedRemoval && (
                          <Text size="sm" c="dimmed">
                            {m.removeExerciseOffline}
                          </Text>
                        )}
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
                          disabled={option.disabled}
                          onClick={option.run}
                        >
                          {option.label}
                        </Menu.Item>
                      ))}
                      {lockedRemoval && (
                        <Menu.Label>{m.removeExerciseOffline}</Menu.Label>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                ))}
            </Group>
            {mode !== 'plan' && guide && (
              <div className={styles.planSummary}>
                <Text size="sm" fw={650} className={styles.planSummaryTitle}>
                  {m.planGuide}
                </Text>
                <div className={styles.planChips}>
                  {guide.sets.map((set, setIndex) => (
                    <div key={setIndex} className={styles.planChip}>
                      <span className={styles.planChipNumber}>
                        {setIndex + 1}
                      </span>
                      <Text component="span" size="sm" fw={650}>
                        {set.weightKg === null
                          ? m.noWeight
                          : `${set.weightKg} кг`}
                      </Text>
                      <Text component="span" size="sm" c="dimmed">
                        × {set.reps}
                      </Text>
                    </div>
                  ))}
                </div>
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
              <span>
                <span className={styles.desktopLabel}>{m.weight}</span>
                <span className={styles.mobileLabel}>{m.resultWeight}</span>
              </span>
              <span>
                <span className={styles.desktopLabel}>{m.reps}</span>
                <span className={styles.mobileLabel}>{m.resultReps}</span>
              </span>
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
                className={styles.addSet}
                variant="light"
                fullWidth
                size="sm"
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
            ...media.exercise,
            sets: media.exercise.sets.map((set) => ({
              ...set,
              reps: set.reps ?? 1,
            })),
          }}
          actual={media.actual}
          session={session}
          canLog={canLog}
          onClose={() => setMedia(null)}
        />
      )}
    </Stack>
  );
}
