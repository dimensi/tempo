import 'server-only';
import type { NutritionDay } from '@/contracts/nutrition';
import type { Measurement } from '@/contracts/measurements';
import { analyticsRangeSchema } from '@/contracts/analytics';
import { authorize } from '@/server/auth/guards';
import { summarizeNutrition, measurementsInRange } from '@/features/analytics';
export class AnalyticsError extends Error {
  constructor(public readonly status: number) {
    super('Analytics unavailable');
  }
}
export interface AnalyticsSources {
  listNutritionDays(
    headers: Headers,
    ownerId: string,
    range: { from: string; to: string },
  ): Promise<NutritionDay[]>;
  listMeasurements(headers: Headers, ownerId: string): Promise<Measurement[]>;
}
// Dependency injection is scoped to each invocation; there is no global/test data source.
export async function loadAnalytics(
  headers: Headers,
  ownerId: string,
  input: unknown,
  sources: AnalyticsSources,
) {
  async function checkAccess() {
    for (const permission of ['nutrition:read', 'measurements:read'] as const) {
      const access = await authorize(headers, permission, ownerId);
      if (!access.ok) throw new AnalyticsError(access.status);
    }
  }
  await checkAccess();
  const parsed = analyticsRangeSchema.safeParse(input);
  if (!parsed.success) throw new AnalyticsError(400);
  const [days, records] = await Promise.all([
    sources.listNutritionDays(headers, ownerId, parsed.data),
    sources.listMeasurements(headers, ownerId),
  ]);
  // A trainer grant may be revoked while the source reads are pending.
  await checkAccess();
  return {
    summary: summarizeNutrition(parsed.data, days),
    measurements: measurementsInRange(parsed.data, records).map(
      ({ id, measuredAt, values }) => ({ id, measuredAt, values }),
    ),
  };
}
