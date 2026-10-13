import 'server-only';
import { listNutritionDays } from '@/server/nutrition';
import { listMeasurements } from '@/server/measurements';
import { getStepsSummary, getWeightHistory } from '@/server/health';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { loadAnalytics } from './loader';
export { AnalyticsError } from './loader';
export async function getAnalytics(
  headers: Headers,
  ownerId: string,
  range: unknown,
  timezone: unknown = 'UTC',
) {
  return loadAnalytics(
    headers,
    ownerId,
    range,
    {
      listNutritionDays,
      listMeasurements,
      weight: getWeightHistory,
      async steps(requestHeaders, requestedOwnerId, period) {
        const summary = await getStepsSummary(requestHeaders, period);
        const updatedAt =
          yazioHealthRepository()
            .steps(requestedOwnerId, period)
            .map((record) => record.observedAt)
            .sort()
            .at(-1) ?? null;
        return { summary, updatedAt };
      },
    },
    timezone,
  );
}
