import 'server-only';
import { diaryDateSchema } from '@/contracts/nutrition';
import { periodSchema } from '@/contracts/nutrition-sync';
import { nutritionAccess } from './access';
import { NutritionAccessError } from './access';
import { nutritionRepository } from './repository';
import { readImage } from './images';
export { NutritionAccessError } from './access';

export async function getNutritionDay(
  headers: Headers,
  ownerId: string,
  date: string,
) {
  await nutritionAccess(headers, ownerId);
  return nutritionRepository().day(ownerId, diaryDateSchema.parse(date));
}
export async function listNutritionDays(
  headers: Headers,
  ownerId: string,
  period: { from: string; to: string },
) {
  await nutritionAccess(headers, ownerId);
  const { from, to } = periodSchema.parse(period);
  return nutritionRepository().list(ownerId, from, to);
}
export async function nutritionDayExists(
  headers: Headers,
  ownerId: string,
  date: string,
) {
  return (await getNutritionDay(headers, ownerId, date)) !== null;
}
export async function getPhotos(
  headers: Headers,
  ownerId: string,
  date: string,
) {
  await nutritionAccess(headers, ownerId);
  return nutritionRepository().photos(ownerId, diaryDateSchema.parse(date));
}
export async function listMealPhotos(
  headers: Headers,
  ownerId: string,
  period: { from: string; to: string },
) {
  await nutritionAccess(headers, ownerId);
  const { from, to } = periodSchema.parse(period);
  return nutritionRepository().listPhotos(ownerId, from, to);
}
export async function readMealPhoto(
  headers: Headers,
  ownerId: string,
  photoId: string,
) {
  await nutritionAccess(headers, ownerId);
  const photo = nutritionRepository().photo(ownerId, photoId);
  if (!photo) throw new NutritionAccessError(404);
  const bytes = await readImage(photo.storageKey);
  // Grants can be revoked while private file I/O is pending.
  await nutritionAccess(headers, ownerId);
  return { bytes, contentType: photo.mime };
}
