import { expect, it } from 'vitest';
import {
  nutritionDaySchema,
  measurementSchema,
  workoutSchema,
} from '@/contracts/v1';
import { nutritionWeek, measurements, workouts } from '@/lib/demo/fixtures';
it('fixtures conform to v1 and are labelled demo', () => {
  expect(nutritionWeek.source).toBe('demo');
  expect(nutritionWeek.data).toHaveLength(7);
  for (const value of nutritionWeek.data) nutritionDaySchema.parse(value);
  for (const value of measurements.data) measurementSchema.parse(value);
  for (const value of workouts.data) workoutSchema.parse(value);
});
it('rejects malformed external normalized data', () => {
  expect(
    nutritionDaySchema.safeParse({ date: 'invalid', meals: [], totals: null })
      .success,
  ).toBe(false);
});
