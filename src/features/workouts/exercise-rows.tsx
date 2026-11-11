'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  NativeSelect,
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
} from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import {
  previousDate,
  progressRange,
  repeatExerciseSets,
} from '@/lib/exercise-progress';
import type { ProgressOccurrence } from '@/contracts/exercise-progress';
import { ExerciseHistory } from '@/components/shared/exercise-progress/history';
import { PreviousExercise } from '@/components/shared/exercise-progress/previous';
import { progressMessages as pm } from '@/components/shared/exercise-progress/messages';
import { BottomSheet } from '@/components/shared/bottom-sheet';
import { useReadOnline } from '@/lib/use-read-online';
import { ExerciseOrder } from './exercise-order';
import type { ExerciseFeedback, Workout } from '@/contracts/workouts';
import type { DraftExercise } from './workout-draft';
import { useUploadedVideos } from './use-uploaded-videos';
import { ExerciseMedia } from './exercise-media';
import { workoutMessages as m } from './messages';
import styles from './day-workout.module.css';

export function ExerciseRows({
  ownerId,
  date,
  canLog,
  exercises,
  session,
  mode,
  onChange,
  onCommit,
  onFeedbackChange,
  disabled = false,
  reordering = false,
  showValidation = false,
  removalPending = false,
}: {
  ownerId: string;
  date: string;
  canLog: boolean;
  exercises: DraftExercise[];
  session?: Workout;
  mode: 'edit' | 'read';
  onChange?: (value: DraftExercise[]) => void;
  onCommit?: () => void;
  onFeedbackChange?: (feedback: ExerciseFeedback) => void;
  disabled?: boolean;
  reordering?: boolean;
  showValidation?: boolean;
  removalPending?: boolean;
}) {
  type MediaEntry = {
    key: string;
    scope: string;
    exercise: DraftExercise;
    initialTab: 'technique' | 'own';
  };
  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [openedMedia, setOpenedMedia] = useState<string | null>(null);
  const mediaScope = `${ownerId}:${session?.id}`;
  const showMedia = (
    exercise: DraftExercise,
    key: string,
    initialTab: 'technique' | 'own' = 'technique',
  ) => {
    const mediaKey = `${mediaScope}:${key}`;
    setMedia((rows) => [
      ...rows.filter((row) => row.scope === mediaScope && row.key !== mediaKey),
      { key: mediaKey, scope: mediaScope, exercise, initialTab },
    ]);
    setOpenedMedia(mediaKey);
  };
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [actions, setActions] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pendingFocus = useRef<{ exercise: number; set: number } | null>(null);
  const weightInputs = useRef(new Map<string, HTMLInputElement>());
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const input = weightInputs.current.get(`${target.exercise}:${target.set}`);
    if (input) {
      input.focus();
      input.select();
      pendingFocus.current = null;
    }
  }, [exercises]);
  const [history, setHistory] = useState<{
    exerciseId: number;
    name: string;
    occurrenceKey: string;
  } | null>(null);
  const [repeat, setRepeat] = useState<{
    key: string;
    row: ProgressOccurrence;
  } | null>(null);
  const ids = [
    ...new Set(
      exercises.flatMap((exercise) =>
        exercise.transformMate ? [exercise.transformMate.exerciseId] : [],
      ),
    ),
  ].sort((a, b) => a - b);
  const summaryQuery = new URLSearchParams({
    ownerId,
    ...progressRange(previousDate(date), 366),
    exerciseIds: ids.join(','),
  });
  if (session?.id) summaryQuery.set('workoutId', session.id);
  const progress = useReadResource(
    readResources.exerciseProgress(
      ids.length
        ? `/api/read/exercise-progress/summary?${summaryQuery}`
        : undefined,
    ),
  );
  const requestRepeat = (key: string, row: ProgressOccurrence) =>
    setRepeat({ key, row });
  const online = useReadOnline();
  const uploaded = useUploadedVideos(ownerId, session?.id);
  const update = (index: number, next: DraftExercise) =>
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
        const openMedia = () => showMedia(exercise, key);
        const titleParts = /^(.*?)\s*(\([^)]*\))$/.exec(exercise.name);
        const existingOccurrence = Boolean(
          session &&
          exercise.id &&
          session.exercises.some((item) => item.id === exercise.id),
        );
        const lockedRemoval = removalPending || (existingOccurrence && !online);
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
                            {removalPending
                              ? m.removalPending
                              : m.removeExerciseOffline}
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
                        <Menu.Label>
                          {removalPending
                            ? m.removalPending
                            : m.removeExerciseOffline}
                        </Menu.Label>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                ))}
            </Group>
            {exercise.transformMate ? (
              <PreviousExercise
                sources={
                  progress.data?.exercises.find(
                    (row) =>
                      row.exerciseId === exercise.transformMate!.exerciseId,
                  )?.sources
                }
                loaded={!!progress.data}
                error={!!progress.error || !online}
                onOpen={() =>
                  setHistory({
                    exerciseId: exercise.transformMate!.exerciseId,
                    name: exercise.name,
                    occurrenceKey: key,
                  })
                }
                onRepeat={
                  onChange && !disabled
                    ? (row) => requestRepeat(key, row)
                    : undefined
                }
              />
            ) : (
              <Text size="sm" c="dimmed" mb="sm">
                {pm.manual}
              </Text>
            )}
            {exercise.id && uploaded.ids.has(exercise.id) && (
              <Button
                variant="light"
                size="sm"
                mb="xs"
                leftSection={<IconPlayerPlay size={18} />}
                aria-label={`${m.uploadedVideos}: ${exercise.name}`}
                onClick={() => showMedia(exercise, key, 'own')}
              >
                {m.uploadedVideos}
              </Button>
            )}
            <div
              className={`${styles.setHeading} ${onChange ? styles.withSetActions : ''}`}
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
              {!onChange && <span />}
            </div>
            {exercise.sets.map((set, setIndex) => (
              <div
                key={setIndex}
                className={`${styles.setRow} ${onChange ? styles.withSetActions : ''}`}
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
                      ref={(input) => {
                        const id = `${index}:${setIndex}`;
                        if (input) weightInputs.current.set(id, input);
                        else weightInputs.current.delete(id);
                      }}
                      aria-label={`${exercise.name}, ${m.set} ${setIndex + 1}, ${m.weight}`}
                      clampBehavior="none"
                      hideControls
                      inputMode="decimal"
                      placeholder={m.noWeight}
                      value={set.weightKg ?? ''}
                      min={0}
                      max={2000}
                      decimalScale={2}
                      disabled={disabled}
                      error={
                        showValidation &&
                        set.weightKg !== null &&
                        (typeof set.weightKg !== 'number' ||
                          set.weightKg < 0 ||
                          set.weightKg > 2000)
                          ? m.invalidWeight
                          : undefined
                      }
                      onChange={(value) =>
                        update(index, {
                          ...exercise,
                          sets: exercise.sets.map((row, i) =>
                            i === setIndex
                              ? {
                                  ...row,
                                  weightKg: value === '' ? null : value,
                                }
                              : row,
                          ),
                        })
                      }
                    />
                    <NumberInput
                      aria-label={`${exercise.name}, ${m.set} ${setIndex + 1}, ${m.reps}`}
                      clampBehavior="none"
                      hideControls
                      inputMode="numeric"
                      placeholder="—"
                      value={set.reps ?? ''}
                      min={1}
                      max={1000}
                      allowDecimal={false}
                      disabled={disabled}
                      error={
                        showValidation &&
                        (set.reps === null ||
                          (set.reps !== null &&
                            (typeof set.reps !== 'number' ||
                              !Number.isInteger(set.reps) ||
                              set.reps < 1 ||
                              set.reps > 1000)))
                          ? m.invalidReps
                          : undefined
                      }
                      onChange={(value) =>
                        update(index, {
                          ...exercise,
                          sets: exercise.sets.map((row, i) =>
                            i === setIndex
                              ? {
                                  ...row,
                                  reps: value === '' ? null : value,
                                }
                              : row,
                          ),
                        })
                      }
                    />
                  </>
                )}
                {onChange ? (
                  <div className={styles.setActions}>
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
                onClick={(event) => {
                  if (event.detail === 0) {
                    pendingFocus.current = {
                      exercise: index,
                      set: exercise.sets.length,
                    };
                  }
                  update(index, {
                    ...exercise,
                    sets: [
                      ...exercise.sets,
                      {
                        reps: exercise.sets.at(-1)?.reps ?? null,
                        weightKg: exercise.sets.at(-1)?.weightKg ?? null,
                        lastValid: null,
                      },
                    ],
                  });
                }}
              >
                {m.addSet}
              </Button>
            )}
            {(onFeedbackChange ||
              (session && session.status !== 'planned')) && (
              <div className={styles.feedback}>
                <NativeSelect
                  label={m.fatigue}
                  aria-label={`${exercise.name}, ${m.fatigue}`}
                  value={exercise.fatigue ?? ''}
                  disabled={disabled || !onFeedbackChange || !exercise.id}
                  data={[
                    { value: '', label: m.notSpecified },
                    ...Array.from({ length: 10 }, (_, i) => ({
                      value: String(i + 1),
                      label: String(i + 1),
                    })),
                  ]}
                  onChange={(event) =>
                    onFeedbackChange?.({
                      exerciseId: exercise.id!,
                      fatigue: event.currentTarget.value
                        ? Number(event.currentTarget.value)
                        : null,
                      failure: exercise.failure ?? null,
                    })
                  }
                />
                <NativeSelect
                  label={m.failure}
                  aria-label={`${exercise.name}, ${m.failure}`}
                  value={exercise.failure ?? ''}
                  disabled={disabled || !onFeedbackChange || !exercise.id}
                  data={[
                    { value: '', label: m.notSpecified },
                    { value: 'full', label: m.failureFull },
                    { value: 'partial', label: m.failurePartial },
                    { value: 'none', label: m.failureNone },
                  ]}
                  onChange={(event) =>
                    onFeedbackChange?.({
                      exerciseId: exercise.id!,
                      fatigue: exercise.fatigue ?? null,
                      failure: (event.currentTarget.value ||
                        null) as ExerciseFeedback['failure'],
                    })
                  }
                />
              </div>
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
      {history && (
        <ExerciseHistory
          key={`${ownerId}:${history.exerciseId}:${session?.id ?? date}`}
          ownerId={ownerId}
          {...history}
          anchorDate={date}
          onClose={() => setHistory(null)}
          onRepeat={
            onChange && !disabled
              ? (row) => {
                  const index = exercises.findIndex(
                    (exercise, i) =>
                      (exercise.id ??
                        exercise.transformMate?.occurrenceKey ??
                        String(i)) === history.occurrenceKey,
                  );
                  const target = exercises[index];
                  if (target)
                    requestRepeat(
                      target.id ??
                        target.transformMate?.occurrenceKey ??
                        String(index),
                      row,
                    );
                }
              : undefined
          }
        />
      )}
      <Modal
        opened={repeat !== null}
        onClose={() => setRepeat(null)}
        title={pm.replace}
        centered
      >
        <Stack>
          <Text>{pm.replaceHint}</Text>
          <Group>
            <Button
              onClick={() => {
                if (!repeat || !onChange || disabled) return;
                onChange(
                  exercises.map((exercise, index) =>
                    (exercise.id ??
                      exercise.transformMate?.occurrenceKey ??
                      String(index)) === repeat.key
                      ? (repeatExerciseSets(exercise, repeat.row) ?? exercise)
                      : exercise,
                  ),
                );
                setRepeat(null);
                setHistory(null);
              }}
            >
              {pm.confirm}
            </Button>
            <Button variant="default" onClick={() => setRepeat(null)}>
              {pm.cancel}
            </Button>
          </Group>
        </Stack>
      </Modal>
      {media
        .filter(
          (entry) =>
            entry.scope === mediaScope &&
            exercises.some(
              (exercise, index) =>
                `${mediaScope}:${exercise.id ?? exercise.transformMate?.occurrenceKey ?? `${index}`}` ===
                entry.key,
            ),
        )
        .map((entry) => (
          <ExerciseMedia
            key={entry.key}
            opened={openedMedia === entry.key}
            ownerId={ownerId}
            exercise={{
              ...entry.exercise,
              sets: entry.exercise.sets.map((set) => ({
                reps: typeof set.reps === 'number' ? set.reps : 1,
                weightKg:
                  typeof set.weightKg === 'number' ? set.weightKg : null,
              })),
            }}
            actual={session?.exercises.find(
              (exercise) => exercise.id === entry.exercise.id,
            )}
            session={session}
            canLog={canLog}
            initialTab={entry.initialTab}
            onVideosChange={uploaded.update}
            onClose={() => setOpenedMedia(null)}
          />
        ))}
    </Stack>
  );
}
