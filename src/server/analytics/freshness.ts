import 'server-only';
import { analyticsRangeSchema } from '@/contracts/analytics';
import {
  savedSourceFreshnessSchema,
  type SavedSourceFreshness,
} from '@/contracts/data-freshness';
import { authorize } from '@/server/auth/guards';
import { getNutritionSchedule } from '@/server/jobs/nutrition-scheduler';
import { measurementRepository } from '@/server/measurements/repository';
import { nutritionRepository } from '@/server/nutrition/repository';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { AnalyticsError } from './loader';

/** Metadata only: never infer a checked-through date from the latest record. */
export function summarizeSavedSource(
  source: SavedSourceFreshness['source'],
  records: Array<{
    date: string;
    fetchedAt?: string | null;
    checkedAt?: string | null;
  }>,
  syncState: SavedSourceFreshness['syncState'] = 'unknown',
): SavedSourceFreshness {
  const latest = (
    values: Array<string | null | undefined>,
    timestamp = false,
  ) =>
    values
      .filter((v): v is string => Boolean(v))
      .sort((a, b) =>
        timestamp ? Date.parse(a) - Date.parse(b) : a.localeCompare(b),
      )
      .at(-1) ?? null;
  return savedSourceFreshnessSchema.parse({
    source,
    state: 'ready',
    syncState,
    latestRecordDate: latest(records.map((r) => r.date)),
    lastFetchedAt: latest(
      records.map((r) => r.fetchedAt),
      true,
    ),
    lastCheckedAt: latest(
      records.map((r) => r.checkedAt),
      true,
    ),
  });
}
export function unavailableSavedSource(
  source: SavedSourceFreshness['source'],
): SavedSourceFreshness {
  return { ...summarizeSavedSource(source, []), state: 'unavailable' };
}

/** Authorized saved reads only. Run metadata is global; observations are range-scoped. */
export async function getSavedDataFreshness(
  headers: Headers,
  ownerId: string,
  input: unknown,
) {
  async function check() {
    for (const permission of ['nutrition:read', 'measurements:read'] as const) {
      const access = await authorize(headers, permission, ownerId);
      if (!access.ok || access.session.user.role !== 'OWNER')
        throw new AnalyticsError(access.ok ? 403 : access.status);
    }
  }
  await check();
  const range = analyticsRangeSchema.parse(input);
  const read = (
    source: SavedSourceFreshness['source'],
    load: () => SavedSourceFreshness,
  ) => {
    try {
      return load();
    } catch {
      return unavailableSavedSource(source);
    }
  };
  const result = {
    nutrition: read('YAZIO', () => {
      const repository = nutritionRepository();
      const records = repository.list(ownerId, range.from, range.to);
      const status = repository.status(ownerId);
      const schedule = getNutritionSchedule(ownerId);
      // Photo failures do not imply failed food reads; skipped dates were not re-fetched.
      const foodSucceeded =
        (status.state === 'completed' || status.state === 'partial') &&
        status.failedDates.length === 0 &&
        status.completedDates.length + status.skippedDates.length > 0;
      return savedSourceFreshnessSchema.parse({
        ...summarizeSavedSource(
          'YAZIO',
          records,
          !status.startedAt
            ? 'unknown'
            : foodSucceeded
              ? 'completed'
              : status.state === 'idle'
                ? 'unknown'
                : status.state,
        ),
        lastRun: {
          startedAt: status.startedAt,
          finishedAt: status.finishedAt,
          failedDates: status.failedDates,
        },
        automatic: {
          enabled: schedule.enabled,
          active: schedule.schedulerActive,
          lastSuccessAt: schedule.lastSuccess,
          lastErrorCode:
            schedule.lastError === 'PHOTO_INCOMPLETE'
              ? null
              : schedule.lastError,
          nextRunAt: schedule.nextRunAt,
        },
      });
    }),
    yazioWeight: read('YAZIO', () =>
      summarizeSavedSource(
        'YAZIO',
        yazioHealthRepository()
          .weights(ownerId, range)
          .map((r) => ({ date: r.measuredDate, fetchedAt: r.observedAt })),
      ),
    ),
    steps: read('YAZIO', () =>
      summarizeSavedSource(
        'YAZIO',
        yazioHealthRepository()
          .steps(ownerId, range)
          .map((r) => ({ date: r.date, fetchedAt: r.observedAt })),
      ),
    ),
    localMeasurements: read('LOCAL', () =>
      summarizeSavedSource(
        'LOCAL',
        measurementRepository()
          .listPeriod(ownerId, range)
          .map((r) => ({ date: r.measuredAt })),
        'not_applicable',
      ),
    ),
  };
  await check();
  return result;
}
