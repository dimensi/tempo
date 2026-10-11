import { z } from 'zod';
// Application contracts, never an assertion about the upstream YAZIO wire format.
export const nutritionTotalsSchema = z.object({
  energyKcal: z.number().nonnegative(),
  proteinGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
});
export const nutritionEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  totals: nutritionTotalsSchema.nullable(),
});
export const nutritionMealSchema = z.object({
  id: z.string(),
  name: z.string(),
  entries: z.array(nutritionEntrySchema),
});
export const nutritionDaySchema = z.object({
  date: z.iso.date(),
  meals: z.array(nutritionMealSchema),
  totals: nutritionTotalsSchema.nullable(),
});
export const measurementSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  kind: z.enum(['weight', 'waist']),
  value: z.number().positive(),
  unit: z.enum(['kg', 'cm']),
});
export const workoutExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export const workoutSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  name: z.string(),
  exercises: z.array(workoutExerciseSchema),
});
export type NutritionTotals = z.infer<typeof nutritionTotalsSchema>;
export type NutritionEntry = z.infer<typeof nutritionEntrySchema>;
export type NutritionMeal = z.infer<typeof nutritionMealSchema>;
export type NutritionDay = z.infer<typeof nutritionDaySchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export interface DataEnvelope<T> {
  contractVersion: 1;
  source: 'demo' | 'user';
  data: T;
}
