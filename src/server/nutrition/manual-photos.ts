import 'server-only';
import { randomUUID } from 'node:crypto';
import { diaryDateSchema, mealKindSchema } from '@/contracts/nutrition';
import { nutritionAccess, NutritionAccessError } from './access';
import { nutritionRepository } from './repository';
import { storeImage } from './images';

export async function uploadMealPhoto(
  headers: Headers,
  ownerId: string,
  date: string,
  daytime: string,
  bytes: Uint8Array,
  mime: string,
) {
  await nutritionAccess(headers, ownerId, 'nutrition:write');
  const parsedDate = diaryDateSchema.parse(date);
  const parsedMeal = mealKindSchema.parse(daytime);
  const stored = await storeImage(bytes, mime);
  const row = {
    id: randomUUID(),
    ownerId,
    date: parsedDate,
    daytime: parsedMeal,
    source: 'manual' as const,
    sourceUrl: null,
    observedAt: new Date().toISOString(),
    mime,
    ...stored,
  };
  nutritionRepository().addPhoto(row);
  return {
    id: row.id,
    date: row.date,
    daytime: row.daytime,
    source: row.source,
    observedAt: row.observedAt,
  };
}
export async function deleteMealPhoto(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await nutritionAccess(headers, ownerId, 'nutrition:write');
  if (!nutritionRepository().deleteManual(ownerId, id))
    throw new NutritionAccessError(404);
}
