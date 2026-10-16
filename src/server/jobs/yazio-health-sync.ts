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
import type { DayWork } from '@/server/yazio/sync-progress';
import { syncReadFailure } from '@/server/yazio/sync-diagnostics';

export async function syncYazioHealthPeriod(
  ownerId: string,
  period: { from: string; to: string },
  upstream: Pick<NutritionUpstream, 'healthSummary' | 'weight'>,
  repository: Pick<ReturnType<typeof yazioHealthRepository>, 'upsert'>,
  assertCurrent: () => void,
  observedAt: string,
  work?: ReadonlyMap<string, DayWork>,
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
  for (const date of work ? work.keys() : periodDates(period)) {
    assertCurrent();
    const selected = work?.get(date) ?? { steps: true, weight: true };
    if (!selected.steps && !selected.weight) continue;
    const started = Date.now();
    let unitContext: string | null = null;
    try {
      const summary = await upstream.healthSummary(date);
      assertCurrent();
      if (selected.steps) dailySteps.push(summary.dailySteps);
      unitContext = summary.unitContext;
      if (selected.steps) result.completedStepsDates.push(date);
    } catch (error) {
      assertCurrent();
      syncReadFailure('steps-summary', date, started, error);
      if (selected.steps) result.failedStepsDates.push(date);
    }
    if (!selected.weight) continue;
    try {
      const weight = await upstream.weight(date, unitContext);
      assertCurrent();
      if (weight) weights.push(weight);
      result.completedWeightDates.push(date);
    } catch (error) {
      assertCurrent();
      syncReadFailure('weight', date, started, error);
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
      {
        steps: result.completedStepsDates,
        weight: result.completedWeightDates,
      },
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
