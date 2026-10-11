import { z } from 'zod';

export type DecimalValue = string;
export const meals = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealKind = (typeof meals)[number];
export interface NutritionTotals {
  calories: DecimalValue | null;
  protein: DecimalValue | null;
  fat: DecimalValue | null;
  carbs: DecimalValue | null;
}
export interface NutritionEntry {
  id: string;
  kind: 'product' | 'recipe' | 'simple' | 'ai';
  name: string;
  meal: MealKind;
  diaryDateTime: string; // API date: no timezone or event semantics supplied
  addedAt: null;
  consumedAt: null;
  editedAt: null;
  sourceId: string | null;
  amount: DecimalValue | null;
  baseUnit: string | null;
  serving: string | null;
  servingQuantity: DecimalValue | null;
  consumedPortions: DecimalValue | null;
  recipePortions: DecimalValue | null;
  massG: DecimalValue | null;
  volumeMl: DecimalValue | null;
  ingredientMassEstimateG: DecimalValue | null;
  totals: NutritionTotals;
  issues: string[];
}
export interface NutritionMeal {
  kind: MealKind;
  entries: NutritionEntry[];
  totals: NutritionTotals; // null per nutrient if any entry is unknown
  knownTotals: NutritionTotals; // explicitly partial, never a substitute for totals
  officialTotals: NutritionTotals;
  delta: NutritionTotals; // computed minus official, including tiny residuals
}
export interface NutritionDay {
  date: string;
  fetchedAt: string;
  meals: NutritionMeal[];
  totals: NutritionTotals;
  knownTotals: NutritionTotals;
  officialTotals: NutritionTotals; // sum of summary meals, not a separate API field
  delta: NutritionTotals;
}

// Transport values are decimal strings; exponent notation preserves very small residuals.
export const decimalStringSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i);
export const nonnegativeDecimalSchema = decimalStringSchema.refine(
  (value) =>
    !value.startsWith('-') || /^-0(?:\.0+)?(?:e[+-]?\d+)?$/i.test(value),
);
const nullableDecimal = nonnegativeDecimalSchema.nullable();
export const mealKindSchema = z.enum(meals);
export const nutritionTotalsSchema = z.object({
  calories: nullableDecimal,
  protein: nullableDecimal,
  fat: nullableDecimal,
  carbs: nullableDecimal,
});
export const nutritionDeltaSchema = z.object({
  calories: decimalStringSchema.nullable(),
  protein: decimalStringSchema.nullable(),
  fat: decimalStringSchema.nullable(),
  carbs: decimalStringSchema.nullable(),
});
export const diaryDateSchema = z.iso.date();
export const diaryDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .refine(
    (value) =>
      z.iso.date().safeParse(value.slice(0, 10)).success &&
      Number(value.slice(11, 13)) < 24 &&
      Number(value.slice(14, 16)) < 60 &&
      Number(value.slice(17, 19)) < 60,
  );
export const nutritionEntrySchema: z.ZodType<NutritionEntry> = z.object({
  id: z.string().min(1),
  kind: z.enum(['product', 'recipe', 'simple', 'ai']),
  name: z.string(),
  meal: mealKindSchema,
  diaryDateTime: diaryDateTimeSchema,
  addedAt: z.null(),
  consumedAt: z.null(),
  editedAt: z.null(),
  sourceId: z.string().nullable(),
  amount: nullableDecimal,
  baseUnit: z.string().nullable(),
  serving: z.string().nullable(),
  servingQuantity: nullableDecimal,
  consumedPortions: nullableDecimal,
  recipePortions: nullableDecimal,
  massG: nullableDecimal,
  volumeMl: nullableDecimal,
  ingredientMassEstimateG: nullableDecimal,
  totals: nutritionTotalsSchema,
  issues: z.array(z.string()),
});
export const nutritionMealSchema: z.ZodType<NutritionMeal> = z.object({
  kind: mealKindSchema,
  entries: z.array(nutritionEntrySchema),
  totals: nutritionTotalsSchema,
  knownTotals: nutritionTotalsSchema,
  officialTotals: nutritionTotalsSchema,
  delta: nutritionDeltaSchema,
});
export const nutritionDaySchema: z.ZodType<NutritionDay> = z
  .object({
    date: diaryDateSchema,
    fetchedAt: z.iso.datetime({ offset: true }),
    meals: z.array(nutritionMealSchema).length(4),
    totals: nutritionTotalsSchema,
    knownTotals: nutritionTotalsSchema,
    officialTotals: nutritionTotalsSchema,
    delta: nutritionDeltaSchema,
  })
  .superRefine((day, context) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    for (const meal of day.meals) {
      if (kinds.has(meal.kind))
        context.addIssue({ code: 'custom', message: 'Duplicate meal kind' });
      kinds.add(meal.kind);
      for (const entry of meal.entries) {
        if (
          ids.has(entry.id) ||
          entry.meal !== meal.kind ||
          entry.diaryDateTime.slice(0, 10) !== day.date
        )
          context.addIssue({
            code: 'custom',
            message: 'Invalid diary entry grouping',
          });
        ids.add(entry.id);
      }
    }
  });
// Server/storage DTO. Do not return this object from a browser-facing endpoint.
export const mealPhotoSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  date: diaryDateSchema,
  daytime: mealKindSchema,
  source: z.enum(['yazio', 'manual']),
  storageKey: z.string().min(1),
  contentHash: z.string().min(1),
  sourceUrl: z.url().nullable(),
  observedAt: z.iso.datetime({ offset: true }),
});
export type MealPhoto = z.infer<typeof mealPhotoSchema>;
// Deliver photo bytes via an authorized endpoint keyed by id; no upstream/storage locator.
export const safeMealPhotoViewSchema = mealPhotoSchema.pick({
  id: true,
  date: true,
  daytime: true,
  source: true,
  observedAt: true,
});
export type SafeMealPhotoView = z.infer<typeof safeMealPhotoViewSchema>;
export function toSafeMealPhotoView(photo: MealPhoto): SafeMealPhotoView {
  return safeMealPhotoViewSchema.parse(photo);
}
// Persistence must enforce one current YAZIO photo per owner/date/daytime; manual photos are unrestricted.
