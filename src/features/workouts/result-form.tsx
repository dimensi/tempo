'use client';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  Box,
  SimpleGrid,
  Fieldset,
} from '@mantine/core';
import {
  IconArrowUp,
  IconArrowDown,
  IconTrash,
  IconPlus,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { PlannedWorkout, WorkoutSessionInput } from '@/contracts/workouts';
import { Catalog } from './catalog';
import { ExerciseDetails } from './exercise-details';
import { selectCatalogExercise } from './transformmate-exercises';
import {
  resultDraftInput,
  type ResultDraft,
  type ResultExercise,
} from './result-draft';
import { workoutMessages as m } from './messages';

export function ResultForm({
  ownerId,
  value,
  planned,
  onChange,
  onSave,
  onCancel,
  busy,
  error,
}: {
  ownerId: string;
  value: ResultDraft;
  planned?: PlannedWorkout;
  onChange: (value: ResultDraft) => void;
  onSave: (value: WorkoutSessionInput) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [validation, setValidation] = useState<string | null>(null);
  const update = (index: number, exercise: ResultExercise) =>
    onChange({
      ...value,
      exercises: value.exercises.map((item, i) =>
        i === index ? exercise : item,
      ),
    });
  const exerciseDraft = (): ResultExercise => ({
    id: crypto.randomUUID(),
    name: '',
    sets: [{ reps: null, weightKg: null }],
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = resultDraftInput(value);
        setValidation(
          parsed.error === 'exercise'
            ? m.resultExerciseRequired
            : parsed.error === 'reps'
              ? m.resultRepsRequired
              : parsed.error
                ? m.validation
                : null,
        );
        if (parsed.data) onSave(parsed.data);
      }}
    >
      <Fieldset disabled={busy} variant="unstyled" p={0}>
        <Stack gap="lg">
          {(error || validation) && (
            <Alert color="red" role="alert">
              {error ?? validation}
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              type="date"
              label={m.date}
              required
              value={value.date}
              onChange={(event) =>
                onChange({ ...value, date: event.currentTarget.value })
              }
            />
            <TextInput
              label={m.optionalTitle}
              maxLength={160}
              value={value.title}
              onChange={(event) =>
                onChange({ ...value, title: event.currentTarget.value })
              }
            />
          </SimpleGrid>
          <Select
            label={m.status}
            allowDeselect={false}
            value={value.status}
            data={(['in_progress', 'completed', 'skipped'] as const).map(
              (status) => ({ value: status, label: m[status] }),
            )}
            onChange={(status) => {
              if (status)
                onChange({ ...value, status: status as ResultDraft['status'] });
            }}
          />
          {value.status !== 'completed' &&
            value.exercises.every((exercise) =>
              exercise.sets.every(
                (set) => set.reps === null && set.weightKg === null,
              ),
            ) && (
              <Text size="sm" c="dimmed">
                {m.noActualRecorded}
              </Text>
            )}
          {value.exercises.map((exercise, index) => {
            const guide = exercise.transformMate
              ? planned?.exercises.find(
                  (item) =>
                    item.transformMate?.occurrenceKey ===
                      exercise.transformMate?.occurrenceKey &&
                    item.transformMate?.exerciseId ===
                      exercise.transformMate?.exerciseId,
                )
              : planned?.exercises[index]?.name === exercise.name
                ? planned.exercises[index]
                : undefined;
            return (
              <Stack
                component="section"
                aria-label={`${m.exercise}: ${exercise.name || index + 1}`}
                key={
                  exercise.id ?? exercise.transformMate?.occurrenceKey ?? index
                }
                gap="sm"
              >
                <Group align="end" wrap="nowrap">
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Catalog
                      key={
                        exercise.transformMate?.occurrenceKey ?? exercise.name
                      }
                      showDetails={false}
                      ownerId={ownerId}
                      exercise={{
                        name: exercise.name,
                        ...(exercise.transformMate
                          ? { transformMate: exercise.transformMate }
                          : {}),
                        sets: [],
                      }}
                      onSelect={(item) =>
                        update(index, selectCatalogExercise(exercise, item))
                      }
                      onManual={(name) => {
                        const next = { ...exercise, name };
                        delete next.transformMate;
                        update(index, next);
                      }}
                    />
                  </Box>
                  <Tooltip label={m.removeExercise}>
                    <ActionIcon
                      size={44}
                      color="red"
                      variant="subtle"
                      aria-label={m.removeExercise}
                      onClick={() =>
                        onChange({
                          ...value,
                          exercises: value.exercises.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Table style={{ tableLayout: 'fixed' }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={40} aria-label={m.set}>
                        {m.setNumber}
                      </Table.Th>
                      {planned && <Table.Th w="25%">{m.planned}</Table.Th>}
                      <Table.Th>{m.actual}</Table.Th>
                      <Table.Th w={44} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {exercise.sets.map((set, setIndex) => (
                      <Table.Tr key={setIndex}>
                        <Table.Td>{setIndex + 1}</Table.Td>
                        {planned && (
                          <Table.Td>
                            <Text size="sm">
                              {guide?.sets[setIndex]
                                ? `${guide.sets[setIndex]!.reps} × ${guide.sets[setIndex]!.weightKg ?? m.noWeight}${guide.sets[setIndex]!.weightKg === null ? '' : ' кг'}`
                                : '—'}
                            </Text>
                          </Table.Td>
                        )}
                        <Table.Td>
                          <Box
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
                              gap: 8,
                            }}
                          >
                            <NumberInput
                              label={m.resultWeight}
                              aria-label={`${m.actual} · ${m.weight} · ${exercise.name} · ${m.set} ${setIndex + 1}`}
                              value={set.weightKg ?? ''}
                              placeholder="—"
                              min={0}
                              max={2000}
                              decimalScale={2}
                              hideControls
                              clampBehavior="none"
                              styles={{
                                input: { minHeight: 44, fontSize: 16 },
                              }}
                              onChange={(weight) =>
                                update(index, {
                                  ...exercise,
                                  sets: exercise.sets.map((item, i) =>
                                    i === setIndex
                                      ? {
                                          ...item,
                                          weightKg:
                                            typeof weight === 'number'
                                              ? weight
                                              : null,
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                            <NumberInput
                              label={m.resultReps}
                              aria-label={`${m.actual} · ${m.reps} · ${exercise.name} · ${m.set} ${setIndex + 1}`}
                              value={set.reps ?? ''}
                              placeholder="—"
                              min={1}
                              max={1000}
                              allowDecimal={false}
                              hideControls
                              clampBehavior="none"
                              styles={{
                                input: { minHeight: 44, fontSize: 16 },
                              }}
                              onChange={(reps) =>
                                update(index, {
                                  ...exercise,
                                  sets: exercise.sets.map((item, i) =>
                                    i === setIndex
                                      ? {
                                          ...item,
                                          reps:
                                            typeof reps === 'number'
                                              ? reps
                                              : null,
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </Box>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={m.removeSet}>
                            <ActionIcon
                              size={44}
                              color="red"
                              variant="subtle"
                              disabled={exercise.sets.length === 1}
                              aria-label={`${m.removeSet} ${setIndex + 1}`}
                              onClick={() =>
                                update(index, {
                                  ...exercise,
                                  sets: exercise.sets.filter(
                                    (_, i) => i !== setIndex,
                                  ),
                                })
                              }
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                <Group justify="space-between">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    mih={44}
                    leftSection={<IconPlus size={16} />}
                    disabled={exercise.sets.length >= 50}
                    onClick={() =>
                      update(index, {
                        ...exercise,
                        sets: [
                          ...exercise.sets,
                          { reps: null, weightKg: null },
                        ],
                      })
                    }
                  >
                    {m.addSet}
                  </Button>
                  {value.exercises.length > 1 && (
                    <Group gap={4}>
                      {[-1, 1].map((direction) => (
                        <Tooltip
                          key={direction}
                          label={direction < 0 ? m.up : m.down}
                        >
                          <ActionIcon
                            size={44}
                            variant="subtle"
                            disabled={
                              index + direction < 0 ||
                              index + direction >= value.exercises.length
                            }
                            aria-label={direction < 0 ? m.up : m.down}
                            onClick={() => {
                              const next = [...value.exercises];
                              [next[index], next[index + direction]] = [
                                next[index + direction]!,
                                next[index]!,
                              ];
                              onChange({ ...value, exercises: next });
                            }}
                          >
                            {direction < 0 ? (
                              <IconArrowUp size={18} />
                            ) : (
                              <IconArrowDown size={18} />
                            )}
                          </ActionIcon>
                        </Tooltip>
                      ))}
                    </Group>
                  )}
                </Group>
                <Textarea
                  label={m.exerciseComment}
                  maxLength={4000}
                  autosize
                  minRows={1}
                  maxRows={4}
                  value={exercise.comment ?? ''}
                  onChange={(event) =>
                    update(index, {
                      ...exercise,
                      comment: event.currentTarget.value,
                    })
                  }
                />
                {exercise.transformMate && (
                  <ExerciseDetails
                    ownerId={ownerId}
                    exerciseId={exercise.transformMate.exerciseId}
                    compactVideo
                  />
                )}
              </Stack>
            );
          })}
          {value.exercises.length < 50 && (
            <Catalog
              label={m.addExercise}
              required={false}
              showDetails={false}
              key={`add-${value.exercises.length}`}
              ownerId={ownerId}
              exercise={{ name: '', sets: [] }}
              onSelect={(item) =>
                onChange({
                  ...value,
                  exercises: [
                    ...value.exercises,
                    selectCatalogExercise(exerciseDraft(), item),
                  ],
                })
              }
              onManual={(name) =>
                onChange({
                  ...value,
                  exercises: [...value.exercises, { ...exerciseDraft(), name }],
                })
              }
            />
          )}
          <Textarea
            label={m.note}
            maxLength={4000}
            autosize
            minRows={1}
            maxRows={6}
            value={value.note}
            onChange={(event) =>
              onChange({ ...value, note: event.currentTarget.value })
            }
          />
          <Box
            p="sm"
            style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 5,
              background: 'var(--mantine-color-body)',
              paddingBottom:
                'max(var(--mantine-spacing-sm),env(safe-area-inset-bottom))',
            }}
          >
            <Group justify="flex-end">
              <Button
                flex={{ base: 1, sm: '0 0 auto' }}
                mih={44}
                variant="default"
                onClick={onCancel}
              >
                {m.cancel}
              </Button>
              <Button
                flex={{ base: 1, sm: '0 0 auto' }}
                mih={44}
                type="submit"
                loading={busy}
              >
                {m.save}
              </Button>
            </Group>
          </Box>
        </Stack>
      </Fieldset>
    </form>
  );
}
