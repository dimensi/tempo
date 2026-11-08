import 'server-only';
import type { ImportedWeight } from '@/contracts/yazio-health';
import type { NutritionUpstream } from '@/server/yazio/adapter';
import type { yazioHealthRepository } from '@/server/yazio/health-repository';
import { deduplicateYazioWeights } from '@/server/yazio/health-normalize';
import type { DayWork } from '@/server/yazio/sync-progress';
import { syncReadFailure } from '@/server/yazio/sync-diagnostics';

type HealthRepository = Pick<
  ReturnType<typeof yazioHealthRepository>,
  'upsert'
>;

export async function syncYazioSteps(
  ownerId: string,
  work: ReadonlyMap<string, DayWork>,
  upstream: Pick<NutritionUpstream, 'healthSummary'>,
  repository: HealthRepository,
  assertCurrent: () => void,
  observedAt: string,
  onSettled: (date: string) => void,
) {
  const completedStepsDates: string[] = [];
  const failedStepsDates: string[] = [];
  for (const [date, selected] of work) {
    if (!selected.steps) continue;
    assertCurrent();
    const started = Date.now();
    try {
      const { dailySteps } = await upstream.healthSummary(date);
      assertCurrent();
      repository.upsert(
        ownerId,
        { dailySteps: [dailySteps], weights: [] },
        observedAt,
        {
          steps: [date],
          weight: [],
        },
      );
      completedStepsDates.push(date);
    } catch (error) {
      assertCurrent();
      syncReadFailure('steps-summary', date, started, error);
      failedStepsDates.push(date);
    }
    onSettled(date);
  }
  return { completedStepsDates, failedStepsDates };
}

export async function syncYazioWeight(
  ownerId: string,
  work: ReadonlyMap<string, DayWork>,
  upstream: Pick<NutritionUpstream, 'healthSummary' | 'weight'>,
  repository: HealthRepository,
  assertCurrent: () => void,
  observedAt: string,
) {
  const completedWeightDates: string[] = [];
  const failedWeightDates: string[] = [];
  const weights: ImportedWeight[] = [];
  // Last-entry responses may repeat the same measurement for several days.
  for (const date of [...work.keys()].sort()) {
    if (!work.get(date)?.weight) continue;
    assertCurrent();
    const started = Date.now();
    const summary = await upstream.healthSummary(date).catch(() => null);
    assertCurrent();
    try {
      const weight = await upstream.weight(date, summary?.unitContext ?? null);
      assertCurrent();
      if (weight) weights.push(weight);
      completedWeightDates.push(date);
    } catch (error) {
      assertCurrent();
      syncReadFailure('weight', date, started, error);
      failedWeightDates.push(date);
    }
  }
  try {
    assertCurrent();
    repository.upsert(
      ownerId,
      { weights: deduplicateYazioWeights(weights), dailySteps: [] },
      observedAt,
      { steps: [], weight: completedWeightDates },
    );
  } catch {
    assertCurrent();
    failedWeightDates.push(...completedWeightDates.splice(0));
  }
  return { completedWeightDates, failedWeightDates };
}
