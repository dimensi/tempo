import { Decimal } from 'decimal.js';

// Decimal strings survive JSON/Next.js serialization. No display rounding here.
const D = Decimal.clone({ precision: 50 });
import {
  meals,
  diaryDateSchema,
  diaryDateTimeSchema,
  nutritionDaySchema,
  nutritionTotalsSchema,
  type NutritionTotals,
  type NutritionEntry,
  type NutritionDay,
  type MealKind,
} from '@/contracts/nutrition';
export type Nutrients = Record<string, number | string | null | undefined>;
export interface Product {
  name: string;
  base_unit: string;
  nutrients: Nutrients;
}
export interface Recipe {
  name: string;
  portion_count: number | string;
  nutrients: Nutrients;
  servings: { amount: number | string; base_unit: string }[];
}
interface Common {
  id: string;
  date: string;
  daytime: MealKind;
}
export interface ProductItem extends Common {
  product_id: string;
  amount: number | string;
  serving: string | null;
  serving_quantity: number | string | null;
}
export interface RecipeItem extends Common {
  recipe_id: string;
  portion_count: number | string;
}
export interface SimpleItem extends Common {
  name: string;
  nutrients: Nutrients;
  is_ai_generated: boolean;
}
export interface ConsumedItems {
  products: ProductItem[];
  recipe_portions: RecipeItem[];
  simple_products: SimpleItem[];
}
const keys = {
  calories: 'energy.energy',
  protein: 'nutrient.protein',
  fat: 'nutrient.fat',
  carbs: 'nutrient.carb',
} as const;
const fields = Object.keys(keys) as (keyof NutritionTotals)[];
const decimal = (n: number | string) => new D(n);
const valid = (n: unknown): n is number | string => {
  if (typeof n !== 'number' && typeof n !== 'string') return false;
  if (
    typeof n === 'string' &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(n)
  )
    return false;
  try {
    return decimal(n).isFinite() && decimal(n).gte(0);
  } catch {
    return false;
  }
};
function totals(
  n: Nutrients | undefined,
  factor: number | string | null,
  issues: string[],
): NutritionTotals {
  return Object.fromEntries(
    fields.map((k) => {
      const value = n?.[keys[k]];
      if (factor === null || !valid(value)) {
        issues.push(`unknown:${k}`);
        return [k, null];
      }
      return [k, decimal(value).mul(factor).toString()];
    }),
  ) as unknown as NutritionTotals;
}
export function sumTotals(
  rows: NutritionTotals[],
  partial = false,
): NutritionTotals {
  rows.forEach((row) => nutritionTotalsSchema.parse(row));
  return Object.fromEntries(
    fields.map((k) => [
      k,
      !partial && rows.some((r) => r[k] === null)
        ? null
        : rows.reduce((s, r) => s.plus(r[k] ?? 0), decimal(0)).toString(),
    ]),
  ) as unknown as NutritionTotals;
}
function difference(a: NutritionTotals, b: NutritionTotals): NutritionTotals {
  return Object.fromEntries(
    fields.map((k) => [
      k,
      a[k] === null || b[k] === null
        ? null
        : decimal(a[k]!).minus(b[k]!).toString(),
    ]),
  ) as unknown as NutritionTotals;
}
function common(item: Common): NutritionEntry {
  diaryDateTimeSchema.parse(item.date);
  if (!meals.includes(item.daytime) || !item.id)
    throw new Error('Invalid diary bucket/id');
  return {
    id: item.id,
    kind: 'product',
    name: item.id,
    meal: item.daytime,
    diaryDateTime: item.date,
    addedAt: null,
    consumedAt: null,
    editedAt: null,
    sourceId: null,
    amount: null,
    baseUnit: null,
    serving: null,
    servingQuantity: null,
    consumedPortions: null,
    recipePortions: null,
    massG: null,
    volumeMl: null,
    ingredientMassEstimateG: null,
    totals: { calories: null, protein: null, fat: null, carbs: null },
    issues: [],
  };
}
export function normalizeProduct(
  item: ProductItem,
  product: Product | null | undefined,
): NutritionEntry {
  const e = common(item);
  e.sourceId = item.product_id;
  e.serving = item.serving;
  e.servingQuantity = valid(item.serving_quantity)
    ? decimal(item.serving_quantity).toString()
    : null;
  e.amount = valid(item.amount) ? decimal(item.amount).toString() : null;
  if (!product) e.issues.push('missing-product');
  else {
    e.name = product.name;
    e.baseUnit = product.base_unit;
    if (product.base_unit === 'g') e.massG = e.amount;
    else if (product.base_unit === 'ml') e.volumeMl = e.amount;
    else e.issues.push('unsupported-base-unit');
  }
  const factor =
    product && ['g', 'ml'].includes(product.base_unit) && valid(item.amount)
      ? item.amount
      : null;
  if (!valid(item.amount)) e.issues.push('invalid-amount');
  e.totals = totals(product?.nutrients, factor, e.issues);
  return e;
}
export function normalizeSimple(item: SimpleItem): NutritionEntry {
  const e = common(item);
  e.kind = item.is_ai_generated ? 'ai' : 'simple';
  e.name = item.name;
  e.totals = totals(item.nutrients, 1, e.issues);
  e.issues.push('mass-unavailable');
  return e;
}
export function normalizeRecipe(
  item: RecipeItem,
  recipe: Recipe | null | undefined,
): NutritionEntry {
  const e = common(item);
  e.kind = 'recipe';
  e.sourceId = item.recipe_id;
  e.consumedPortions = valid(item.portion_count)
    ? decimal(item.portion_count).toString()
    : null;
  if (!recipe) e.issues.push('missing-recipe');
  else {
    e.name = recipe.name;
    e.recipePortions = valid(recipe.portion_count)
      ? decimal(recipe.portion_count).toString()
      : null;
    if (
      valid(recipe.portion_count) &&
      decimal(recipe.portion_count).gt(0) &&
      valid(item.portion_count) &&
      recipe.servings.length > 0 &&
      recipe.servings.every((s) => s.base_unit === 'g' && valid(s.amount))
    ) {
      e.ingredientMassEstimateG = recipe.servings
        .reduce((s, r) => s.plus(r.amount), decimal(0))
        .mul(item.portion_count)
        .div(recipe.portion_count)
        .toString();
    } else e.issues.push('ingredient-mass-unavailable');
  }
  // Nutrients are already per recipe portion. Do not divide by recipe.portion_count.
  e.totals = totals(
    recipe?.nutrients,
    valid(item.portion_count) ? item.portion_count : null,
    e.issues,
  );
  if (!valid(item.portion_count)) e.issues.push('invalid-portions');
  e.issues.push('cooked-mass-unavailable');
  return e;
}
export interface NormalizeDayInput {
  date: string;
  fetchedAt: string;
  items: ConsumedItems;
  products: Record<string, Product | null>;
  recipes: Record<string, Recipe | null>;
  summary: { meals: Partial<Record<MealKind, { nutrients: Nutrients }>> };
}

export function normalizeDay(input: NormalizeDayInput): NutritionDay {
  diaryDateSchema.parse(input.date);
  const entries = [
    ...input.items.products.map((i) =>
      normalizeProduct(i, input.products[i.product_id]),
    ),
    ...input.items.recipe_portions.map((i) =>
      normalizeRecipe(i, input.recipes[i.recipe_id]),
    ),
    ...input.items.simple_products.map(normalizeSimple),
  ];
  const ids = new Set<string>();
  for (const e of entries) {
    if (!meals.includes(e.meal) || e.diaryDateTime.slice(0, 10) !== input.date)
      throw new Error('Invalid diary bucket/date');
    if (ids.has(e.id)) throw new Error(`Duplicate entry id: ${e.id}`);
    ids.add(e.id);
  }
  const normalizedMeals = meals.map((kind) => {
    const rows = entries.filter((e) => e.meal === kind);
    const computed = sumTotals(rows.map((e) => e.totals));
    const official = totals(input.summary.meals[kind]?.nutrients, 1, []);
    return {
      kind,
      entries: rows,
      totals: computed,
      knownTotals: sumTotals(
        rows.map((e) => e.totals),
        true,
      ),
      officialTotals: official,
      delta: difference(computed, official),
    };
  });
  const computed = sumTotals(normalizedMeals.map((m) => m.totals));
  const official = sumTotals(normalizedMeals.map((m) => m.officialTotals));
  return nutritionDaySchema.parse({
    date: input.date,
    fetchedAt: input.fetchedAt,
    meals: normalizedMeals,
    totals: computed,
    knownTotals: sumTotals(normalizedMeals.map((m) => m.knownTotals)),
    officialTotals: official,
    delta: difference(computed, official),
  });
}
