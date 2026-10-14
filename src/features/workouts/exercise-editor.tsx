'use client';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
  NumberInput,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { WorkoutExercise } from '@/contracts/workouts';
import { selectCatalogExercise } from './transformmate-exercises';
import { Catalog } from './catalog';
import { ExerciseDetails } from './exercise-details';
import { workoutMessages as m } from './messages';

export const emptyExercise = (): WorkoutExercise => ({
  id: crypto.randomUUID(),
  name: '',
  sets: [{ reps: 10, weightKg: null }],
});
export function ExerciseEditor({
  value,
  onChange,
  ownerId,
}: {
  ownerId?: string;
  value: WorkoutExercise[];
  onChange: (value: WorkoutExercise[]) => void;
}) {
  const update = (index: number, exercise: WorkoutExercise) =>
    onChange(value.map((item, i) => (i === index ? exercise : item)));
  return (
    <Stack>
      {value.map((exercise, index) => (
        <Paper
          key={exercise.id ?? exercise.transformMate?.occurrenceKey ?? index}
          withBorder
          p="sm"
          component="section"
          aria-label={`${m.exercise} · ${exercise.name || index + 1}`}
        >
          <Stack gap="sm">
            <Group align="end" wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                {ownerId ? (
                  <Catalog
                    key={exercise.transformMate?.occurrenceKey ?? exercise.name}
                    showDetails={false}
                    ownerId={ownerId}
                    exercise={exercise}
                    onSelect={(item) =>
                      update(index, selectCatalogExercise(exercise, item))
                    }
                    onManual={(name) => {
                      const manual = { ...exercise, name };
                      delete manual.transformMate;
                      update(index, manual);
                    }}
                  />
                ) : (
                  <TextInput
                    label={m.exercise}
                    value={exercise.name}
                    required
                    maxLength={160}
                    onChange={(event) =>
                      update(index, {
                        ...exercise,
                        name: event.currentTarget.value,
                      })
                    }
                  />
                )}
              </div>
              <ActionIcon
                size={44}
                variant="subtle"
                color="red"
                aria-label={m.removeExercise}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <IconTrash size={18} />
              </ActionIcon>
            </Group>
            {exercise.sets.map((set, setIndex) => (
              <Box key={setIndex}>
                <Text size="sm">
                  {m.set} {setIndex + 1}
                </Text>
                <Box
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 44px',
                    gap: 'var(--mantine-spacing-xs)',
                    alignItems: 'end',
                  }}
                >
                  <NumberInput
                    hideControls
                    label={m.weight}
                    placeholder={m.noWeight}
                    value={set.weightKg ?? ''}
                    min={0}
                    max={2000}
                    decimalScale={2}
                    onChange={(weight) =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.map((item, i) =>
                          i === setIndex
                            ? {
                                ...item,
                                weightKg:
                                  typeof weight === 'number' ? weight : null,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <NumberInput
                    hideControls
                    label={m.reps}
                    value={set.reps}
                    min={1}
                    max={1000}
                    allowDecimal={false}
                    required
                    onChange={(reps) =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.map((item, i) =>
                          i === setIndex
                            ? {
                                ...item,
                                reps: typeof reps === 'number' ? reps : 0,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <ActionIcon
                    size={44}
                    color="red"
                    variant="subtle"
                    disabled={exercise.sets.length === 1}
                    aria-label={`${m.removeSet} ${setIndex + 1}`}
                    onClick={() =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.filter((_, i) => i !== setIndex),
                      })
                    }
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                </Box>
              </Box>
            ))}
            <Button
              mih={44}
              variant="light"
              disabled={exercise.sets.length >= 50}
              onClick={() =>
                update(index, {
                  ...exercise,
                  sets: [...exercise.sets, { reps: 10, weightKg: null }],
                })
              }
            >
              {m.addSet}
            </Button>

            {ownerId && exercise.transformMate && (
              <ExerciseDetails
                key={`${ownerId}-${exercise.transformMate.exerciseId}`}
                ownerId={ownerId}
                exerciseId={exercise.transformMate.exerciseId}
              />
            )}
            <Stack>
              <Textarea
                label={m.exerciseComment}
                maxLength={4000}
                value={exercise.comment ?? ''}
                onChange={(event) =>
                  update(index, {
                    ...exercise,
                    comment: event.currentTarget.value,
                  })
                }
              />
              {value.length > 1 && (
                <Group grow>
                  <Button
                    mih={44}
                    variant="subtle"
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...value];
                      [next[index - 1], next[index]] = [
                        next[index]!,
                        next[index - 1]!,
                      ];
                      onChange(next);
                    }}
                  >
                    {m.up}
                  </Button>
                  <Button
                    mih={44}
                    variant="subtle"
                    disabled={index === value.length - 1}
                    onClick={() => {
                      const next = [...value];
                      [next[index], next[index + 1]] = [
                        next[index + 1]!,
                        next[index]!,
                      ];
                      onChange(next);
                    }}
                  >
                    {m.down}
                  </Button>
                </Group>
              )}
              {exercise.transformMate && (
                <Button
                  variant="subtle"
                  mih={44}
                  onClick={() => {
                    const manual = { ...exercise };
                    delete manual.transformMate;
                    update(index, manual);
                  }}
                >
                  {m.makeManual}
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>
      ))}
      {ownerId && value.length < 50 ? (
        <Catalog
          label={m.addExercise}
          required={false}
          key={`add-${value.length}`}
          ownerId={ownerId}
          exercise={emptyExercise()}
          onSelect={(item) =>
            onChange([...value, selectCatalogExercise(emptyExercise(), item)])
          }
          onManual={(name) =>
            onChange([...value, { ...emptyExercise(), name }])
          }
        />
      ) : (
        <Button
          mih={44}
          variant="light"
          disabled={value.length >= 50}
          onClick={() => onChange([...value, emptyExercise()])}
        >
          {m.addExercise}
        </Button>
      )}
    </Stack>
  );
}
