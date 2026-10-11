import 'server-only';
import { z } from 'zod';
import { mealKindSchema, diaryDateTimeSchema } from '@/contracts/nutrition';
import {
  createYazioClient,
  yazioRequest,
  type YazioTokenStore,
} from './client';
// Coordinated task explicitly permits this pure domain contract sub-entry.
// eslint-disable-next-line no-restricted-imports
import type {
  NormalizeDayInput,
  Product,
  Recipe,
  ConsumedItems,
} from '@/features/nutrition/domain';

const scalar = z.union([z.number(), z.string(), z.null()]);
const nutrients = z.record(z.string(), scalar);
const common = {
  id: z.string().min(1),
  date: diaryDateTimeSchema,
  daytime: mealKindSchema,
};
const itemsSchema = z.object({
  products: z.array(
    z.object({
      ...common,
      product_id: z.string().min(1),
      amount: scalar,
      serving: z.string().nullable(),
      serving_quantity: scalar,
    }),
  ),
  recipe_portions: z.array(
    z.object({
      ...common,
      recipe_id: z.string().min(1),
      portion_count: scalar,
    }),
  ),
  simple_products: z.array(
    z.object({
      ...common,
      name: z.string(),
      nutrients,
      is_ai_generated: z.boolean(),
    }),
  ),
});
const productSchema = z
  .object({ name: z.string(), base_unit: z.string(), nutrients })
  .nullable();
const recipeSchema = z
  .object({
    name: z.string(),
    portion_count: scalar,
    nutrients,
    servings: z.array(z.object({ amount: scalar, base_unit: z.string() })),
  })
  .nullable();
const summarySchema = z.object({
  meals: z.object({
    breakfast: z.object({ nutrients }),
    lunch: z.object({ nutrients }),
    dinner: z.object({ nutrients }),
    snack: z.object({ nutrients }),
  }),
});
const imagesSchema = z.partialRecord(mealKindSchema, z.url());
export interface NutritionUpstream {
  items(date: string): Promise<ConsumedItems>;
  summary(date: string): Promise<NormalizeDayInput['summary']>;
  images(
    date: string,
  ): Promise<Partial<Record<z.infer<typeof mealKindSchema>, string>>>;
  product(id: string): Promise<Product | null>;
  recipe(id: string): Promise<Recipe | null>;
}
export async function nutritionUpstream(
  store: YazioTokenStore,
): Promise<NutritionUpstream> {
  const client = await createYazioClient(store);
  // Capability check prevents an old SDK from silently deleting photo slots.
  const user = client.user as typeof client.user & {
    getMealImages?: (options: { date: string }) => Promise<unknown>;
  };
  if (typeof user.getMealImages !== 'function')
    throw new Error('YAZIO SDK meal-images support is required');
  return {
    items: (date) =>
      yazioRequest(
        async () =>
          itemsSchema.parse(
            await user.getConsumedItems({ date }),
          ) as ConsumedItems,
      ),
    summary: (date) =>
      yazioRequest(async () =>
        summarySchema.parse(await user.getDailySummary({ date })),
      ),
    images: (date) =>
      yazioRequest(async () =>
        imagesSchema.parse(await user.getMealImages!({ date })),
      ),
    product: (id) =>
      yazioRequest(
        async () =>
          productSchema.parse(await client.products.get(id)) as Product | null,
      ),
    recipe: (id) =>
      yazioRequest(
        async () =>
          recipeSchema.parse(await user.getRecipe(id)) as Recipe | null,
      ),
  };
}
