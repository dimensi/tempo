import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { nutritionRepository } from '@/server/nutrition/repository';
import { syncNutritionPeriod } from '@/server/jobs/nutrition-sync';
import type { NutritionDayUpstream } from '@/server/yazio/adapter';

vi.mock('server-only', () => ({}));
let database: ReturnType<typeof openDatabase>;
let repository: ReturnType<typeof nutritionRepository>;
const date = '2026-01-01';
const nutrients = {
  'energy.energy': 1,
  'nutrient.protein': 0.1,
  'nutrient.fat': 0.2,
  'nutrient.carb': 0.3,
};

function upstream(): NutritionDayUpstream {
  return {
    items: vi.fn(async () => ({
      products: [
        {
          id: 'entry',
          date: `${date} 12:00:00`,
          daytime: 'lunch' as const,
          product_id: 'product',
          amount: 10,
          serving: null,
          serving_quantity: null,
        },
      ],
      recipe_portions: [],
      simple_products: [],
    })),
    summary: vi.fn(async () => ({ meals: { lunch: { nutrients } } })),
    images: vi.fn(async () => ({})),
    product: vi.fn(async () => ({
      name: 'Synthetic product',
      base_unit: 'g',
      nutrients,
    })),
    recipe: vi.fn(async () => null),
  };
}

beforeEach(() => {
  database = openDatabase('file::memory:');
  migrate(database.db, { migrationsFolder: './drizzle' });
  database.db
    .insert(user)
    .values({
      id: 'owner',
      role: 'OWNER',
      name: 'Synthetic',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  repository = nutritionRepository(database);
});
afterEach(() => database.sqlite.close());

it('persists a completed day once and keeps the last durable snapshot on an upstream failure', async () => {
  const source = upstream();
  expect(
    (
      await syncNutritionPeriod(
        'owner',
        { from: date, to: date },
        source,
        repository,
      )
    ).state,
  ).toBe('completed');
  const previous = repository.day('owner', date)!;
  expect(previous.meals[1]?.totals.calories).toBe('10');

  vi.mocked(source.summary).mockRejectedValueOnce(
    new Error('Synthetic outage'),
  );
  await expect(
    syncNutritionPeriod(
      'owner',
      { from: date, to: date },
      source,
      repository,
      undefined,
      { force: true },
    ),
  ).resolves.toMatchObject({ state: 'failed', failedDates: [date] });
  expect(repository.day('owner', date)).toEqual(previous);
});
