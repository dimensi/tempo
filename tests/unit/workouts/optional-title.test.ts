import { afterEach, expect, it, vi } from 'vitest';
import {
  workoutPlanInputSchema,
  workoutSessionSchema,
} from '@/contracts/workouts';
import { workoutTitle } from '@/lib/workout-title';
import { copyPlanToDate } from '@/features/workouts/copy-plan';
import {
  createProjection,
  updateProjection,
} from '@/server/workouts/transformmate/mapping';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import { trainingDetailFixture } from '../../fixtures/transformmate';
vi.mock('server-only', () => ({}));
const workout = {
  id: 'selected',
  date: '2026-10-12',
  title: '',
  exercises: [
    {
      name: 'Приседание',
      comment: 'Медленно',
      transformMate: {
        exerciseId: 7,
        occurrenceKey: '00000000-0000-4000-8000-000000000001',
      },
      sets: [{ reps: 8, weightKg: 40 }],
    },
  ],
};
const input = {
  title: '',
  description: '',
  startsOn: workout.date,
  endsOn: workout.date,
  workouts: [workout],
};
const originalTimezone = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTimezone;
});
it('preserves intentional blank names, including historical session snapshots, while requiring exercise names', () => {
  expect(workoutPlanInputSchema.parse(input).title).toBe('');
  expect(
    workoutPlanInputSchema.safeParse({
      ...input,
      workouts: [
        {
          ...workout,
          exercises: [{ name: '', sets: workout.exercises[0]!.sets }],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    workoutSessionSchema.parse({
      id: 'session',
      ownerId: 'owner',
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      date: workout.date,
      title: '',
      note: '',
      status: 'completed',
      exercises: workout.exercises,
      planId: 'plan',
      plannedWorkoutId: workout.id,
      planSnapshot: { planTitle: '', workout },
    }).planSnapshot?.planTitle,
  ).toBe('');
});
it.each(['Pacific/Honolulu', 'Pacific/Kiritimati', 'Europe/Berlin'])(
  'formats calendar day without shift in %s',
  (timezone) => {
    process.env.TZ = timezone;
    expect(workoutTitle('', '2026-10-12')).toBe('Тренировка · 12 октября');
    expect(workoutTitle('Моё название', '2026-10-12')).toBe('Моё название');
  },
);
it('copying a selected workout preserves only its planned data with fresh identities', () => {
  const copy = copyPlanToDate(input, '2026-10-24');
  expect(copy.workouts).toHaveLength(1);
  expect(copy.workouts[0]).toMatchObject({
    date: '2026-10-24',
    title: '',
    exercises: [
      {
        name: 'Приседание',
        comment: 'Медленно',
        sets: [{ reps: 8, weightKg: 40 }],
        transformMate: { exerciseId: 7 },
      },
    ],
  });
  expect(copy.workouts[0]!.id).not.toBe(workout.id);
  expect(copy.workouts[0]!.exercises[0]!.transformMate?.occurrenceKey).not.toBe(
    workout.exercises[0]!.transformMate.occurrenceKey,
  );
  expect(Object.keys(copy)).toEqual([
    'title',
    'description',
    'startsOn',
    'endsOn',
    'workouts',
  ]);
  expect(Object.keys(copy.workouts[0]!)).toEqual([
    'id',
    'date',
    'title',
    'exercises',
  ]);
});
it('required provider name is generated consistently only at create/update boundary', () => {
  expect(createProjection(workout, 'marker').name).toBe(
    'Тренировка · 12 октября',
  );
  const training = transformMateTrainingDetailSchema.parse(
    trainingDetailFixture(),
  );
  const remote = training.protocols[0]!.workout_exercises[0]!;
  const previous = {
    ...workout,
    exercises: [
      {
        ...workout.exercises[0]!,
        transformMate: {
          ...workout.exercises[0]!.transformMate,
          exerciseId: remote.exercise.id,
        },
      },
    ],
  };
  const desired = structuredClone(previous);
  expect(updateProjection(training, previous, desired).body.name).toBe(
    'Тренировка · 12 октября',
  );
  expect(desired.title).toBe('');
});
