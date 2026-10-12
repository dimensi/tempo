import 'server-only';
import { z } from 'zod';
import { transformMateCatalogSchema } from '@/server/transformmate/catalog-schema';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const name = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes(','));
export const transformMateExerciseFiltersSchema = z.strictObject({
  commonMuscleGroup: name.optional(),
  muscleGroups: z.array(name).max(50).optional(),
  search: z.string().max(500).optional(),
});
export const transformMateExercisePageInputSchema =
  transformMateExerciseFiltersSchema.extend({
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  });
export const transformMateMuscleGroupSchema = z.looseObject({
  id,
  name: z.string(),
  image: z.string().nullable(),
  muscles: z.array(id),
  common_muscle_group: z.looseObject({ id, name: z.string() }),
});
export const transformMateMuscleGroupsSchema = z.array(
  transformMateMuscleGroupSchema,
);
export const transformMateExercisePageSchema = z.looseObject({
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: transformMateCatalogSchema,
});
export type TransformMateExerciseFilters = z.infer<
  typeof transformMateExerciseFiltersSchema
>;
export type TransformMateExercisePageInput = z.infer<
  typeof transformMateExercisePageInputSchema
>;
export function exerciseQuery(input: TransformMateExercisePageInput) {
  const query = new URLSearchParams();
  if (input.commonMuscleGroup)
    query.set('common_muscle_group', input.commonMuscleGroup);
  if (input.muscleGroups?.length)
    query.set('muscle_group', input.muscleGroups.join(','));
  if (input.search) query.set('search', input.search);
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  if (input.offset !== undefined) query.set('offset', String(input.offset));
  return query.size ? `?${query}` : '';
}

export function parseExerciseFilters(input: unknown, page = false) {
  const parsed = (
    page
      ? transformMateExercisePageInputSchema
      : transformMateExerciseFiltersSchema
  ).safeParse(input);
  if (!parsed.success)
    throw new Error('Invalid TransformMate exercise filters');
  return parsed.data;
}
