'use client';
import {
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import type { WorkoutExercise } from '@/contracts/workouts';
import { workoutMessages as m } from './messages';

export const emptyExercise = (): WorkoutExercise => ({
  name: '',
  sets: [{ reps: 10, weightKg: null }],
});
export function ExerciseEditor({
  value,
  onChange,
}: {
  value: WorkoutExercise[];
  onChange: (value: WorkoutExercise[]) => void;
}) {
  const update = (index: number, exercise: WorkoutExercise) =>
    onChange(value.map((item, i) => (i === index ? exercise : item)));
  return (
    <Stack>
      {value.map((exercise, index) => (
        <Paper key={index} withBorder p="sm">
          <Stack>
            <TextInput
              label={`${m.exercise} ${index + 1}`}
              value={exercise.name}
              required
              maxLength={160}
              onChange={(event) =>
                update(index, { ...exercise, name: event.currentTarget.value })
              }
            />
            {exercise.sets.map((set, setIndex) => (
              <Stack gap="xs" key={setIndex}>
                <Text size="sm">
                  {m.set} {setIndex + 1}
                </Text>
                <SimpleGrid cols={2}>
                  <NumberInput
                    label={`${m.reps} ${index + 1}.${setIndex + 1}`}
                    value={set.reps}
                    min={1}
                    max={1000}
                    allowDecimal={false}
                    required
                    onChange={(value) =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.map((item, i) =>
                          i === setIndex
                            ? {
                                ...item,
                                reps: typeof value === 'number' ? value : 0,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <NumberInput
                    label={`${m.weight} ${index + 1}.${setIndex + 1}`}
                    placeholder={m.noWeight}
                    value={set.weightKg ?? ''}
                    min={0}
                    max={2000}
                    decimalScale={2}
                    onChange={(value) =>
                      update(index, {
                        ...exercise,
                        sets: exercise.sets.map((item, i) =>
                          i === setIndex
                            ? {
                                ...item,
                                weightKg:
                                  typeof value === 'number' ? value : null,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </SimpleGrid>
                <Button
                  mih={44}
                  variant="subtle"
                  color="red"
                  disabled={exercise.sets.length === 1}
                  onClick={() =>
                    update(index, {
                      ...exercise,
                      sets: exercise.sets.filter((_, i) => i !== setIndex),
                    })
                  }
                >
                  {m.removeSet} {setIndex + 1}
                </Button>
              </Stack>
            ))}
            <Group grow>
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
              <Button
                mih={44}
                color="red"
                variant="subtle"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                {m.removeExercise} {index + 1}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ))}
      <Button
        mih={44}
        variant="light"
        disabled={value.length >= 50}
        onClick={() => onChange([...value, emptyExercise()])}
      >
        {m.addExercise}
      </Button>
    </Stack>
  );
}
