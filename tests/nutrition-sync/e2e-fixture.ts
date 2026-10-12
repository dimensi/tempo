// Test-only CLI arrangement: no HTTP endpoint, credentials or SDK implementation.
// Invoke with node --conditions=react-server --import tsx to honor server-only imports.
import { eq } from 'drizzle-orm';
import { openDatabase } from '@/server/db/connection';
import { user, trainerAccess } from '@/server/db/schema';
import { nutritionRepository } from '@/server/nutrition/repository';
import { syncNutritionPeriod } from '@/server/jobs/nutrition-sync';
import { storeImage } from '@/server/nutrition/images';
import type { NutritionDayUpstream } from '@/server/yazio/adapter';

if (
  process.env.DATABASE_URL !== 'file:./.data/e2e.sqlite' ||
  process.env.UPLOADS_DIR !== './.data/e2e-nutrition-uploads' ||
  process.env.BETTER_AUTH_URL !==
    `http://localhost:${process.env.NUTRITION_CONNECTION_E2E_PORT ?? '3135'}`
)
  throw new Error('Only isolated synthetic E2E configuration is allowed');
const database = openDatabase(process.env.DATABASE_URL);
try {
  const owner = database.db
    .select()
    .from(user)
    .where(eq(user.role, 'OWNER'))
    .get()!;
  const trainer = database.db
    .select()
    .from(user)
    .where(eq(user.role, 'TRAINER'))
    .get()!;
  if (
    owner.email !== 'owner@example.test' ||
    trainer.email !== 'trainer@example.test'
  )
    throw new Error('Expected disposable E2E users');
  const scenario = process.argv[2];
  if (scenario === 'grant') {
    database.db
      .insert(trainerAccess)
      .values({
        ownerId: owner.id,
        trainerId: trainer.id,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    console.log(JSON.stringify({ ownerId: owner.id }));
  } else if (scenario === 'revoke') {
    database.db
      .delete(trainerAccess)
      .where(eq(trainerAccess.trainerId, trainer.id))
      .run();
    console.log(JSON.stringify({ ownerId: owner.id }));
  } else {
    if (!['initial', 'error', 'image-error', 'empty'].includes(scenario ?? ''))
      throw new Error('Unknown fixture scenario');
    const nutrients = {
      'energy.energy': 1,
      'nutrient.protein': 0.1,
      'nutrient.fat': 0.2,
      'nutrient.carb': 0.3,
    };
    const date = '2026-01-01';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxkAAAAASUVORK5CYII=',
      'base64',
    );
    const upstream: NutritionDayUpstream = {
      async items(day) {
        if (scenario === 'error') throw new Error('Synthetic upstream failure');
        return {
          products:
            scenario === 'empty'
              ? []
              : [
                  {
                    id: `synthetic-${day}`,
                    date: `${day} 12:00:00`,
                    daytime: 'lunch',
                    product_id: 'synthetic-product',
                    amount: scenario === 'image-error' ? 20 : 10,
                    serving: null,
                    serving_quantity: null,
                  },
                ],
          recipe_portions: [],
          simple_products: [],
        };
      },
      async summary() {
        return {
          meals: {
            breakfast: { nutrients },
            lunch: { nutrients },
            dinner: { nutrients },
            snack: { nutrients },
          },
        };
      },
      async images(day) {
        return day === date && scenario !== 'empty'
          ? { lunch: 'https://images.yazio-cdn.com/synthetic-only.png' }
          : {};
      },
      async product() {
        return { name: 'Synthetic E2E product', base_unit: 'g', nutrients };
      },
      async recipe() {
        return null;
      },
    };
    const status = await syncNutritionPeriod(
      owner.id,
      { from: date, to: scenario === 'initial' ? '2026-01-02' : date },
      upstream,
      nutritionRepository(database),
      {
        async fetch() {
          if (scenario === 'image-error')
            throw new Error('Synthetic image network failure');
          return { bytes: png, mime: 'image/png' };
        },
        store: storeImage,
      },
    );
    console.log(JSON.stringify({ ownerId: owner.id, status }));
  }
} finally {
  database.sqlite.close();
}
