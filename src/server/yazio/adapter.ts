import 'server-only';
import { z } from 'zod';
import { yazioHealthUpstream } from './health-adapter';
import { normalizeHealthSummary } from './health-normalize';
import { mealKindSchema, diaryDateTimeSchema } from '@/contracts/nutrition';
import {
  createYazioAuth,
  yazioRequest,
  YazioIntegrationError,
  type YazioTokenStore,
} from './client';
import {
  getUserConsumedItems,
  getUserDailySummary,
  getUserMealImages,
  getProduct,
  getRecipe,
  getUserWeight,
} from '@dimensi/yazio/api';
import type { Token } from '@dimensi/yazio/auth';
import { retryYazioRead } from '@/server/yazio/read-request';
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
export interface NutritionDayUpstream {
  items(date: string): Promise<ConsumedItems>;
  summary(date: string): Promise<NormalizeDayInput['summary']>;
  images(
    date: string,
  ): Promise<Partial<Record<z.infer<typeof mealKindSchema>, string>>>;
  product(id: string): Promise<Product | null>;
  recipe(id: string): Promise<Recipe | null>;
}
export interface NutritionUpstream extends NutritionDayUpstream {
  healthSummary(
    date: string,
  ): Promise<ReturnType<typeof normalizeHealthSummary>>;
  weight: ReturnType<typeof yazioHealthUpstream>['weight'];
}
export async function nutritionUpstream(
  store: YazioTokenStore,
): Promise<NutritionUpstream> {
  const auth = await createYazioAuth(store);
  const projectRead = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (cause) {
      throw new YazioIntegrationError('UPSTREAM_FAILURE', { cause });
    }
  };
  if (typeof getUserMealImages !== 'function')
    throw new Error('YAZIO SDK meal-images support is required');
  const read = async <T>(
    operation: Parameters<typeof retryYazioRead>[1]['operation'],
    date: string | undefined,
    fetch: (token: Token) => Promise<T>,
  ) => {
    await store.assertCurrent?.();
    // A rejected OAuth refresh is never replayed by the GET retry loop.
    const token = await yazioRequest(() => auth.authenticate());
    return retryYazioRead(
      () => fetch(token),
      { operation, ...(date ? { date } : {}) },
      () => store.assertCurrent?.(),
    );
  };
  const health = yazioHealthUpstream({
    getWeight: ({ date }) =>
      read('weight', date, (token) => getUserWeight(token, { date })),
    getDailySummary: ({ date }) => rawSummary(date),
  });
  // One adapter is constructed for each leased run. Cache transport outcomes,
  // including rejection: food and health share one bounded retry sequence per date.
  const summaries = new Map<string, ReturnType<typeof getUserDailySummary>>();
  const rawSummary = (date: string) => {
    z.iso.date().parse(date);
    let pending = summaries.get(date);
    if (!pending) {
      if (summaries.size >= 366)
        throw new Error('Summary period limit exceeded');
      pending = read('summary', date, (token) =>
        getUserDailySummary(token, { date }),
      );
      summaries.set(date, pending);
    }
    return pending;
  };
  return {
    healthSummary: async (date) =>
      normalizeHealthSummary(await rawSummary(date), date),
    weight: health.weight,
    items: (date) =>
      projectRead(
        async () =>
          itemsSchema.parse(
            await read('items', date, (token) =>
              getUserConsumedItems(token, { date }),
            ),
          ) as ConsumedItems,
      ),
    summary: (date) =>
      projectRead(async () => summarySchema.parse(await rawSummary(date))),
    images: (date) =>
      projectRead(async () =>
        imagesSchema.parse(
          await read('photos', date, (token) =>
            getUserMealImages(token, { date }),
          ),
        ),
      ),
    product: (id) =>
      projectRead(
        async () =>
          productSchema.parse(
            await read('product', undefined, (token) => getProduct(token, id)),
          ) as Product | null,
      ),
    recipe: (id) =>
      projectRead(
        async () =>
          recipeSchema.parse(
            await read('recipe', undefined, (token) => getRecipe(token, id)),
          ) as Recipe | null,
      ),
  };
}
