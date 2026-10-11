import { describe, expect, it } from 'vitest';
import {
  workoutPlanInputSchema,
  workoutSessionInputSchema,
  sessionCreateSchema,
} from '@/contracts/workouts';
const exercise = { name: 'Приседание', sets: [{ reps: 8, weightKg: 20 }] };
const plan = {
  title: 'План',
  description: '',
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  workouts: [
    { id: 'a', date: '2026-10-11', title: 'Силовая', exercises: [exercise] },
  ],
};
describe('workout contracts', () => {
  it('rejects invalid ranges, dates outside range and duplicate workout IDs', () => {
    expect(workoutPlanInputSchema.safeParse(plan).success).toBe(true);
    expect(
      workoutPlanInputSchema.safeParse({ ...plan, endsOn: '2026-09-30' })
        .success,
    ).toBe(false);
    expect(
      workoutPlanInputSchema.safeParse({
        ...plan,
        workouts: [{ ...plan.workouts[0], date: '2026-11-01' }],
      }).success,
    ).toBe(false);
    expect(
      workoutPlanInputSchema.safeParse({
        ...plan,
        workouts: [...plan.workouts, ...plan.workouts],
      }).success,
    ).toBe(false);
  });
  it('rejects invalid sets and unknown fields, while allowing bodyweight', () => {
    const input = {
      date: '2026-10-11',
      title: 'Силовая',
      exercises: [exercise],
      note: '',
      status: 'completed',
    };
    expect(
      workoutSessionInputSchema.safeParse({ ...input, ownerId: 'spoof' })
        .success,
    ).toBe(false);
    expect(
      workoutSessionInputSchema.safeParse({
        ...input,
        exercises: [
          { name: 'Отжимание', sets: [{ reps: 12, weightKg: null }] },
        ],
      }).success,
    ).toBe(true);
    for (const reps of [0, -1, 1.5, 1001])
      expect(
        workoutSessionInputSchema.safeParse({
          ...input,
          exercises: [{ ...exercise, sets: [{ reps, weightKg: 0 }] }],
        }).success,
      ).toBe(false);
  });
  it('completed sessions require actual exercises and references are paired', () => {
    const input = {
      date: '2026-10-11',
      title: 'Тренировка',
      exercises: [],
      note: '',
      status: 'completed',
    };
    expect(workoutSessionInputSchema.safeParse(input).success).toBe(false);
    expect(
      workoutSessionInputSchema.safeParse({ ...input, status: 'skipped' })
        .success,
    ).toBe(true);
    expect(
      sessionCreateSchema.safeParse({
        ...input,
        status: 'skipped',
        planId: 'a',
      }).success,
    ).toBe(false);
  });
});
