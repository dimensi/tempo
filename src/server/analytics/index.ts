import 'server-only';
import { listNutritionDays } from '@/server/nutrition';
import { listMeasurements } from '@/server/measurements';
import { loadAnalytics } from './loader';
export { AnalyticsError } from './loader';
export async function getAnalytics(
  headers: Headers,
  ownerId: string,
  range: unknown,
) {
  return loadAnalytics(headers, ownerId, range, {
    listNutritionDays,
    listMeasurements,
  });
}
