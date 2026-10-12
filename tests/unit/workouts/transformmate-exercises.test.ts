import { describe, expect, it } from 'vitest';
import type { TransformMateActual } from '@/contracts/transformmate';
import type { WorkoutExercise } from '@/contracts/workouts';
import {
  actualSetForExercise,
  selectCatalogExercise,
} from '@/features/workouts/transformmate-exercises';
const exercise: WorkoutExercise = {
  name: 'Первое',
  sets: [{ reps: 10, weightKg: null }],
  transformMate: {
    exerciseId: 7,
    occurrenceKey: '00000000-0000-4000-8000-000000000001',
  },
};
const actual: TransformMateActual = {
  date: '2026-10-12',
  title: 'Тренировка',
  started: null,
  finished: null,
  exercises: [
    {
      name: 'Первое',
      exerciseId: 7,
      occurrenceKey: exercise.transformMate!.occurrenceKey,
      comment: '',
      sets: [
        {
          order: 1,
          done: true,
          metrics: [
            { name: 'Повторения', unit: '', type: 'single', values: ['9'] },
          ],
        },
      ],
    },
  ],
};
describe('catalog occurrence identity', () => {
  it('preserves identity only for reselecting the same exercise', () => {
    expect(
      selectCatalogExercise(exercise, { id: 7, name: 'Первое', canPlan: true })
        .transformMate?.occurrenceKey,
    ).toBe(exercise.transformMate?.occurrenceKey);
    const changed = selectCatalogExercise(exercise, {
      id: 9,
      name: 'Другое',
      canPlan: true,
    });
    expect(changed.transformMate?.occurrenceKey).not.toBe(
      exercise.transformMate?.occurrenceKey,
    );
    expect(actualSetForExercise(actual, changed, 1)).toBeUndefined();
    expect(changed.sets).toEqual(exercise.sets);
  });
  it('requires both occurrence identity and exercise ID before showing actual beside a plan set', () => {
    expect(actualSetForExercise(actual, exercise, 1)?.done).toBe(true);
    expect(
      actualSetForExercise(
        actual,
        {
          ...exercise,
          transformMate: { ...exercise.transformMate!, exerciseId: 9 },
        },
        1,
      ),
    ).toBeUndefined();
    expect(actualSetForExercise(actual, exercise, 2)).toBeUndefined();
    expect(
      actualSetForExercise(actual, { name: 'Ручное', sets: exercise.sets }, 1),
    ).toBeUndefined();
  });
});
