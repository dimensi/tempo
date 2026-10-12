'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
  Text,
} from '@mantine/core';
import {
  workoutPlanInputSchema,
  workoutSessionInputSchema,
  type WorkoutPlanInput,
  type WorkoutSessionInput,
} from '@/contracts/workouts';
import { ExerciseEditor, emptyExercise } from './exercise-editor';
import { workoutTitle } from '@/lib/workout-title';
import { workoutMessages as m } from './messages';

export const today = () => new Date().toLocaleDateString('en-CA');
export const emptyPlan = (): WorkoutPlanInput => ({
  title: '',
  description: '',
  startsOn: today(),
  endsOn: today(),
  workouts: [
    {
      id: crypto.randomUUID(),
      date: today(),
      title: '',
      exercises: [emptyExercise()],
    },
  ],
});
export const emptySession = (): WorkoutSessionInput => ({
  date: today(),
  title: '',
  exercises: [emptyExercise()],
  note: '',
  status: 'completed',
});
type Controls = { busy: boolean; error: string | null; onCancel: () => void };
function Footer({ busy, onCancel }: Controls) {
  return (
    <Group grow>
      <Button mih={44} variant="default" disabled={busy} onClick={onCancel}>
        {m.cancel}
      </Button>
      <Button mih={44} type="submit" loading={busy}>
        {m.save}
      </Button>
    </Group>
  );
}

export function PlanForm({
  initial,
  onSave,
  ownerId,
  workoutId,
  onChange,
  preservePeriod = false,
  ...controls
}: Controls & {
  ownerId: string;
  workoutId?: string;
  preservePeriod?: boolean;
  initial: WorkoutPlanInput;
  onChange?: (value: WorkoutPlanInput) => void;
  onSave: (value: WorkoutPlanInput) => void;
}) {
  const [value, setDraft] = useState(initial);
  const setValue = (next: WorkoutPlanInput) => {
    setDraft(next);
    onChange?.(next);
  };
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = workoutPlanInputSchema.safeParse(value);
        setInvalid(!parsed.success);
        if (parsed.success) onSave(parsed.data);
      }}
    >
      <Stack>
        {(invalid || controls.error) && (
          <Alert color="red" role="alert">
            {controls.error ?? m.validation}
          </Alert>
        )}
        <Text size="sm">
          {value.workouts.every(
            (workout) =>
              workout.exercises.length > 0 &&
              workout.exercises.every((exercise) => exercise.transformMate),
          )
            ? m.catalogHint
            : m.localHint}
        </Text>
        {!workoutId && (
          <>
            <TextInput
              label={m.planTitle}
              maxLength={160}
              value={value.title}
              onChange={(event) =>
                setValue({ ...value, title: event.currentTarget.value })
              }
            />
            <Textarea
              label={m.descriptionLabel}
              maxLength={4000}
              value={value.description}
              onChange={(event) =>
                setValue({ ...value, description: event.currentTarget.value })
              }
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                type="date"
                label={m.startsOn}
                required
                value={value.startsOn}
                onChange={(event) =>
                  setValue({ ...value, startsOn: event.currentTarget.value })
                }
              />
              <TextInput
                type="date"
                label={m.endsOn}
                required
                value={value.endsOn}
                onChange={(event) =>
                  setValue({ ...value, endsOn: event.currentTarget.value })
                }
              />
            </SimpleGrid>
          </>
        )}
        {value.workouts.map((workout, index) => {
          if (workoutId && workout.id !== workoutId) return null;
          const update = (change: Partial<typeof workout>) =>
            setValue({
              ...value,
              workouts: value.workouts.map((item, i) =>
                i === index ? { ...item, ...change } : item,
              ),
            });
          return (
            <Stack key={workout.id}>
              <Stack>
                <Text fw={600}>
                  {workoutTitle(workout.title, workout.date)}
                </Text>
                {!workoutId && (
                  <Group grow>
                    <Button
                      mih={44}
                      variant="subtle"
                      disabled={index === 0}
                      onClick={() => {
                        const workouts = [...value.workouts];
                        [workouts[index - 1], workouts[index]] = [
                          workouts[index]!,
                          workouts[index - 1]!,
                        ];
                        setValue({ ...value, workouts });
                      }}
                    >
                      {m.up}
                    </Button>
                    <Button
                      mih={44}
                      variant="subtle"
                      disabled={index === value.workouts.length - 1}
                      onClick={() => {
                        const workouts = [...value.workouts];
                        [workouts[index], workouts[index + 1]] = [
                          workouts[index + 1]!,
                          workouts[index]!,
                        ];
                        setValue({ ...value, workouts });
                      }}
                    >
                      {m.down}
                    </Button>
                  </Group>
                )}
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label={m.date}
                    type="date"
                    required
                    min={preservePeriod ? value.startsOn : undefined}
                    max={preservePeriod ? value.endsOn : undefined}
                    value={workout.date}
                    onChange={(event) => {
                      const date = event.currentTarget.value;
                      const workouts = value.workouts.map((item, i) =>
                        i === index ? { ...item, date } : item,
                      );
                      setValue({
                        ...value,
                        workouts,
                        startsOn: preservePeriod
                          ? value.startsOn
                          : value.workouts.length === 1
                            ? date
                            : value.startsOn < date
                              ? value.startsOn
                              : date,
                        endsOn: preservePeriod
                          ? value.endsOn
                          : value.workouts.length === 1
                            ? date
                            : value.endsOn > date
                              ? value.endsOn
                              : date,
                      });
                    }}
                  />
                  <TextInput
                    label={m.optionalTitle}
                    maxLength={160}
                    value={workout.title}
                    onChange={(event) =>
                      update({ title: event.currentTarget.value })
                    }
                  />
                </SimpleGrid>
                <ExerciseEditor
                  ownerId={ownerId}
                  value={workout.exercises}
                  onChange={(exercises) => update({ exercises })}
                />
                {!workoutId && (
                  <Button
                    mih={44}
                    color="red"
                    variant="subtle"
                    disabled={value.workouts.length === 1}
                    onClick={() =>
                      setValue({
                        ...value,
                        workouts: value.workouts.filter((_, i) => i !== index),
                      })
                    }
                  >
                    {m.removeWorkout}
                  </Button>
                )}
              </Stack>
            </Stack>
          );
        })}
        {!workoutId && (
          <Button
            mih={44}
            variant="light"
            disabled={value.workouts.length >= 100}
            onClick={() =>
              setValue({
                ...value,
                workouts: [
                  ...value.workouts,
                  {
                    id: crypto.randomUUID(),
                    date: value.startsOn,
                    title: '',
                    exercises: [emptyExercise()],
                  },
                ],
              })
            }
          >
            {m.addWorkout}
          </Button>
        )}
        <Paper
          p="sm"
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 5,
            paddingBottom:
              'max(var(--mantine-spacing-sm), env(safe-area-inset-bottom))',
          }}
        >
          <Footer {...controls} />
        </Paper>
      </Stack>
    </form>
  );
}
export function SessionForm({
  initial,
  onSave,
  ownerId,
  ...controls
}: Controls & {
  ownerId: string;
  initial: WorkoutSessionInput;
  onSave: (value: WorkoutSessionInput) => void;
}) {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = workoutSessionInputSchema.safeParse(value);
        setInvalid(!parsed.success);
        if (parsed.success) onSave(parsed.data);
      }}
    >
      <Stack>
        {(invalid || controls.error) && (
          <Alert color="red" role="alert">
            {controls.error ?? m.validation}
          </Alert>
        )}
        <TextInput
          label={m.optionalTitle}
          maxLength={160}
          value={value.title}
          onChange={(event) =>
            setValue({ ...value, title: event.currentTarget.value })
          }
        />
        <TextInput
          label={m.date}
          type="date"
          required
          value={value.date}
          onChange={(event) =>
            setValue({ ...value, date: event.currentTarget.value })
          }
        />
        <Select
          label={m.status}
          allowDeselect={false}
          value={value.status}
          data={(['in_progress', 'completed', 'skipped'] as const).map(
            (status) => ({ value: status, label: m[status] }),
          )}
          onChange={(status) => {
            if (status)
              setValue({
                ...value,
                status: status as WorkoutSessionInput['status'],
              });
          }}
        />
        <ExerciseEditor
          ownerId={ownerId}
          value={value.exercises}
          onChange={(exercises) => setValue({ ...value, exercises })}
        />
        <Textarea
          label={m.note}
          maxLength={4000}
          value={value.note}
          onChange={(event) =>
            setValue({ ...value, note: event.currentTarget.value })
          }
        />
        <Footer {...controls} />
      </Stack>
    </form>
  );
}
