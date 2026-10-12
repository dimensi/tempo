import 'server-only';
import type {
  HealthSyncResult,
  ImportedWeight,
  DailySteps,
} from '@/contracts/yazio-health';
import type { NutritionUpstream } from '@/server/yazio/adapter';
import type { yazioHealthRepository } from '@/server/yazio/health-repository';
import { deduplicateYazioWeights } from '@/server/yazio/health-normalize';
import { periodDates } from './nutrition-sync';

export async function syncYazioHealthPeriod(
  ownerId: string,
  period: { from: string; to: string },
  upstream: Pick<NutritionUpstream, 'healthSummary' | 'weight'>,
  repository: Pick<ReturnType<typeof yazioHealthRepository>, 'upsert'>,
  assertCurrent: () => void,
  observedAt: string,
): Promise<HealthSyncResult> {
  const result: HealthSyncResult = {
    completedStepsDates: [],
    failedStepsDates: [],
    completedWeightDates: [],
    failedWeightDates: [],
    error: null,
  };
  const dailySteps: DailySteps[] = [];
  const weights: ImportedWeight[] = [];
  for (const date of periodDates(period)) {
    assertCurrent();
    let unitContext: string | null = null;
    try {
      const summary = await upstream.healthSummary(date);
      assertCurrent();
      dailySteps.push(summary.dailySteps);
      unitContext = summary.unitContext;
      result.completedStepsDates.push(date);
    } catch {
      assertCurrent();
      result.failedStepsDates.push(date);
    }
    try {
      const weight = await upstream.weight(date, unitContext);
      assertCurrent();
      if (weight) weights.push(weight);
      result.completedWeightDates.push(date);
    } catch {
      assertCurrent();
      result.failedWeightDates.push(date);
    }
  }
  try {
    assertCurrent();
    repository.upsert(
      ownerId,
      {
        weights: deduplicateYazioWeights(weights),
        dailySteps,
      },
      observedAt,
    );
  } catch {
    assertCurrent();
    // The repository transaction rolls the complete health batch back.
    result.failedStepsDates.push(...result.completedStepsDates);
    result.failedWeightDates.push(...result.completedWeightDates);
    result.completedStepsDates = [];
    result.completedWeightDates = [];
  }
  if (result.failedStepsDates.length || result.failedWeightDates.length)
    result.error = 'HEALTH_IMPORT_FAILED';
  return result;
}
