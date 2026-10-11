import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  normalizeDay,
  normalizeProduct,
  normalizeRecipe,
  normalizeSimple,
  sumTotals,
  type ProductItem,
  type RecipeItem,
  type SimpleItem,
} from '@/features/nutrition/domain';
const base = {
  id: 'test',
  date: '2026-10-10 10:35:44',
  daytime: 'breakfast' as const,
};
const item: ProductItem = {
  ...base,
  product_id: 'p',
  amount: 92,
  serving: 'egg.large',
  serving_quantity: 2,
};
const nutrients = {
  'energy.energy': 1.96,
  'nutrient.protein': 0.1361,
  'nutrient.fat': 0.1484,
  'nutrient.carb': 0.0083,
};
const product = { name: 'egg', base_unit: 'g', nutrients };
test('egg: base-unit multiplication, no serving double scaling', () => {
  assert.deepEqual(normalizeProduct(item, product).totals, {
    calories: '180.32',
    protein: '12.5212',
    fat: '13.6528',
    carbs: '0.7636',
  });
  assert.deepEqual(
    normalizeProduct({ ...item, serving_quantity: 999 }, product).totals,
    normalizeProduct(item, product).totals,
  );
});
test('ml stays volume, including named serving', () => {
  const e = normalizeProduct(
    { ...item, amount: 125, serving: 'can', serving_quantity: 1 },
    {
      name: 'yogurt',
      base_unit: 'ml',
      nutrients: { ...nutrients, 'energy.energy': 0.85 },
    },
  );
  assert.equal(e.totals.calories, '106.25');
  assert.equal(e.massG, null);
  assert.equal(e.volumeMl, '125');
});
test('manual and AI nutrients are ready totals; names do not define mass', () => {
  const i: SimpleItem = {
    ...base,
    name: 'salad 100g',
    is_ai_generated: true,
    nutrients: { ...nutrients, 'energy.energy': 383 },
  };
  const e = normalizeSimple(i);
  assert.equal(e.totals.calories, '383');
  assert.equal(e.massG, null);
  assert.equal(
    normalizeSimple({ ...i, is_ai_generated: false }).totals.calories,
    '383',
  );
});
test('fractional recipe portions multiply per-portion nutrients only', () => {
  const i: RecipeItem = { ...base, recipe_id: 'r', portion_count: 1.5 };
  const e = normalizeRecipe(i, {
    name: 'recipe',
    portion_count: 10,
    nutrients: { ...nutrients, 'energy.energy': 222.45 },
    servings: [
      { amount: 1000, base_unit: 'g' },
      { amount: 475, base_unit: 'g' },
    ],
  });
  assert.equal(e.totals.calories, '333.675');
  assert.equal(e.ingredientMassEstimateG, '221.25');
  assert.equal(e.massG, null);
});
test('mixed g/ml recipe has no invented mass', () => {
  const e = normalizeRecipe(
    { ...base, recipe_id: 'r', portion_count: 2 },
    {
      name: 'pancakes',
      portion_count: 25,
      nutrients,
      servings: [
        { amount: 930, base_unit: 'ml' },
        { amount: 708, base_unit: 'g' },
      ],
    },
  );
  assert.equal(e.ingredientMassEstimateG, null);
  assert.equal(e.totals.calories, '3.92');
});
test('missing nutrient remains unknown; zero is known', () => {
  const e = normalizeProduct(item, {
    ...product,
    nutrients: { 'energy.energy': 0 },
  });
  assert.deepEqual(e.totals, {
    calories: '0',
    protein: null,
    fat: null,
    carbs: null,
  });
});
test('missing product and recipe retain entries and unknown totals', () => {
  assert.equal(normalizeProduct(item, null).totals.calories, null);
  assert.equal(
    normalizeRecipe({ ...base, recipe_id: 'gone', portion_count: 1 }, null)
      .totals.calories,
    null,
  );
});
test('invalid amount/base unit/recipe divisor do not invent results', () => {
  assert.equal(
    normalizeProduct({ ...item, amount: NaN }, product).totals.calories,
    null,
  );
  assert.equal(
    normalizeProduct(item, { ...product, base_unit: 'piece' }).totals.calories,
    null,
  );
  const e = normalizeRecipe(
    { ...base, recipe_id: 'r', portion_count: 1 },
    {
      name: 'r',
      portion_count: 0,
      nutrients,
      servings: [{ amount: 100, base_unit: 'g' }],
    },
  );
  assert.equal(e.ingredientMassEstimateG, null);
  assert.equal(e.totals.calories, '1.96');
});
test('partial sums are explicitly separate', () => {
  const unknown = normalizeProduct(item, null).totals;
  const known = normalizeProduct(item, product).totals;
  assert.equal(sumTotals([unknown, known]).calories, null);
  assert.equal(sumTotals([unknown, known], true).calories, '180.32');
});
const syntheticDay = () => ({
  date: '2026-10-10',
  fetchedAt: '2026-10-11T00:00:00Z',
  items: {
    products: [],
    recipe_portions: [],
    simple_products: [
      ...['349.32', '572.348', '518.08', '548.47'].map((calories, index) => ({
        id: `entry-${index}`,
        date: '2026-10-10 09:00:00',
        daytime: ['breakfast', 'lunch', 'dinner', 'snack'][
          index
        ] as SimpleItem['daytime'],
        name: 'Synthetic meal',
        is_ai_generated: false,
        nutrients: {
          'energy.energy': calories,
          'nutrient.protein': '0',
          'nutrient.fat': '0',
          'nutrient.carb': '0',
        },
      })),
    ],
  },
  products: {},
  recipes: {},
  summary: {
    meals: {
      breakfast: { nutrients: { 'energy.energy': '349.32000000000005' } },
      lunch: { nutrients: { 'energy.energy': '572.348' } },
      dinner: { nutrients: { 'energy.energy': '518.08' } },
      snack: { nutrients: { 'energy.energy': '548.47' } },
    },
  },
});
test('synthetic control preserves 1988.218 kcal and tiny residuals', () => {
  const d = normalizeDay(syntheticDay());
  assert.equal(d.totals.calories, '1988.218');
  assert.equal(d.meals[0]!.delta.calories, '-5e-14');
  assert.equal(d.delta.calories, '-5e-14');
});
test('different ids with equal payload are retained; chronology is unknown', () => {
  const input = syntheticDay();
  const first = input.items.simple_products[0]!;
  input.items.simple_products = [first, { ...first, id: 'another' }];
  const d = normalizeDay(input);
  assert.equal(d.meals[0]!.entries.length, 2);
  assert.equal(d.meals[0]!.totals.calories, '698.64');
  assert.equal(d.meals[0]!.entries[0]!.addedAt, null);
  assert.equal(d.meals[0]!.entries[0]!.consumedAt, null);
  assert.equal(d.meals[0]!.entries[0]!.editedAt, null);
});
test('invalid meal/date or duplicate entry id cannot silently disappear', () => {
  const input = {
    date: '2026-10-10',
    fetchedAt: '2026-10-11T00:00:00Z',
    items: { products: [item, item], recipe_portions: [], simple_products: [] },
    products: { p: product },
    recipes: {},
    summary: { meals: {} },
  };
  assert.throws(() => normalizeDay(input), /Duplicate/);
  assert.throws(
    () =>
      normalizeDay({
        ...input,
        items: {
          ...input.items,
          products: [{ ...item, date: '2026-10-09 09:00:00' }],
        },
      }),
    /date/,
  );
});

test('input numeric validation rejects nonfinite, negative and nondecimal syntax', () => {
  for (const amount of [
    NaN,
    Infinity,
    -1,
    'NaN',
    'Infinity',
    '-0.1',
    '0xff',
    '0b10',
    '',
    ' 2 ',
    'oops',
  ]) {
    const e = normalizeProduct({ ...item, amount }, product);
    assert.equal(e.amount, null);
    assert.equal(e.totals.calories, null);
    assert.ok(e.issues.includes('invalid-amount'));
  }
  for (const value of [NaN, Infinity, -1, 'nope', '0xff']) {
    assert.equal(
      normalizeSimple({
        ...base,
        name: 'Synthetic',
        is_ai_generated: false,
        nutrients: { 'energy.energy': value },
      }).totals.calories,
      null,
    );
  }
});
test('decimal strings retain coefficients beyond binary number precision', () => {
  const e = normalizeProduct(
    { ...item, amount: '3.00000000000000001' },
    { ...product, nutrients: { 'energy.energy': '0.123456789012345678' } },
  );
  assert.equal(e.totals.calories, '0.37037036703703703523456789012345678');
});
test('recipe portions may exceed recipe yield and repeating estimate retains precision', () => {
  const e = normalizeRecipe(
    { ...base, recipe_id: 'r', portion_count: '10' },
    {
      name: 'Synthetic',
      portion_count: '3',
      nutrients: { 'energy.energy': '2' },
      servings: [{ amount: '1', base_unit: 'g' }],
    },
  );
  assert.equal(e.totals.calories, '20');
  assert.equal(
    e.ingredientMassEstimateG,
    '3.3333333333333333333333333333333333333333333333333',
  );
  assert.equal(e.massG, null);
});
test('empty meals have computed zero but missing official values are unknown', () => {
  const d = normalizeDay({
    ...syntheticDay(),
    items: { products: [], recipe_portions: [], simple_products: [] },
    summary: { meals: {} },
  });
  assert.equal(d.totals.calories, '0');
  assert.equal(d.knownTotals.calories, '0');
  assert.equal(d.officialTotals.calories, null);
  assert.equal(d.delta.calories, null);
});

test('sumTotals validates transport numeric inputs rather than accepting malformed decimals', () => {
  assert.throws(() =>
    sumTotals([
      { calories: 'Infinity', protein: null, fat: null, carbs: null },
    ]),
  );
  assert.throws(() =>
    sumTotals([{ calories: '-1', protein: null, fat: null, carbs: null }]),
  );
});
