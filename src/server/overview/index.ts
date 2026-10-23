import 'server-only';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import {
  dateInTimezone,
  shiftDate,
  timezoneSchema,
} from '@/contracts/nutrition-sync-dates';
import type { OverviewData } from '@/contracts/overview';
import { authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getDatabase } from '@/server/db';
import { listNutritionDays } from '@/server/nutrition';
import { nutritionRepository } from '@/server/nutrition/repository';
import { summarizeNutrition } from '@/features/analytics';
import { getNutritionSchedule } from '@/server/jobs/nutrition-scheduler';
import { canonicalYazioBodyValue } from '@/lib/yazio-observations';

export class OverviewError extends Error {
  constructor(public status: number) {
    super('Overview unavailable');
  }
}
export async function getOverview(
  headers: Headers,
  inputTimezone: unknown,
  now = new Date(),
): Promise<OverviewData> {
  const timezone = timezoneSchema.safeParse(inputTimezone);
  if (!timezone.success) throw new OverviewError(400);
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) {
    const session = await authorize(headers, 'yazio:manage');
    throw new OverviewError(!session.ok && session.status === 401 ? 401 : 403);
  }
  async function check() {
    let role = '';
    for (const permission of [
      'nutrition:read',
      'measurements:read',
      'workouts:read',
    ] as const) {
      const access = await authorize(headers, permission, ownerId!);
      if (!access.ok) throw new OverviewError(access.status);
      role = access.session.user.role;
    }
    return role;
  }
  const role = await check();
  const today = dateInTimezone(now, timezone.data);
  const range = { from: shiftDate(today, -6), to: today };
  const days = await listNutritionDays(headers, ownerId, range);
  const summary = summarizeNutrition(range, days);
  const { sqlite } = getDatabase();
  // Combine canonical measurements with unlinked YAZIO observations, as in
  // weight history. This owner's imported weights are confirmed kilograms.
  // Keep linked imports out so local edits remain authoritative.
  const weightProjection = `WITH weight_observations AS (
    SELECT m.id, m.measured_at AS date, json_extract(v.value, '$.value') AS value, 1 AS local
    FROM measurements m, json_each(m.values_json) v
    WHERE m.owner_id = @ownerId AND json_extract(v.value, '$.metric') = 'weight'
      AND json_extract(v.value, '$.unit') = 'kg'
    UNION ALL
    SELECT w.external_id AS id, coalesce(w.measured_date, substr(w.provider_date, 1, 10)) AS date, w.raw_value AS value, 0 AS local
    FROM yazio_weight_entries w
    WHERE w.owner_id = @ownerId AND w.raw_value IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM yazio_body_links l WHERE l.owner_id = w.owner_id
        AND l.provider_id = w.external_id AND l.metric = 'weight' AND l.measurement_id IS NOT NULL)
  )`;
  type WeightRow = { date: string; value: string; local: number };
  const weightRows = sqlite
    .prepare(
      `${weightProjection} SELECT date, value, local FROM weight_observations
       WHERE date >= @from AND date <= @to ORDER BY date, local, id`,
    )
    .all({ ownerId, from: shiftDate(today, -29), to: today }) as WeightRow[];
  const latestRow = sqlite
    .prepare(
      `${weightProjection} SELECT date, value, local FROM weight_observations
       WHERE date <= @to ORDER BY date DESC, local DESC, id DESC LIMIT 1`,
    )
    .get({ ownerId, to: today }) as WeightRow | undefined;
  const weight = (row: WeightRow) =>
    row.local ? row.value : (canonicalYazioBodyValue(row.value) ?? row.value);
  const points = Array.from({ length: 30 }, (_, i) => {
    const date = shiftDate(today, i - 29);
    const observations = weightRows.filter((row) => row.date === date);
    return observations.length
      ? observations.map((row) => ({ date, value: weight(row) }))
      : [{ date, value: null }];
  }).flat();
  // Project existing persisted workout DTOs to title/date only, with scope and LIMIT in SQL.
  const planned = sqlite
    .prepare(
      `SELECT json_extract(data, '$.title') as title, date FROM workouts WHERE owner_id = ? AND date >= ? AND json_extract(data, '$.status') = 'planned' ORDER BY date, id LIMIT 1`,
    )
    .get(ownerId, today) as { title: string; date: string } | undefined;
  const completed = sqlite
    .prepare(
      `SELECT json_extract(data, '$.title') as title, date FROM workouts WHERE owner_id = ? AND date <= ? AND json_extract(data, '$.status') = 'completed' ORDER BY date DESC, updated_at DESC, id DESC LIMIT 1`,
    )
    .get(ownerId, today) as { title: string; date: string } | undefined;
  const data: OverviewData = {
    today,
    timezone: timezone.data,
    goals: dailyGoalsRepository().day(ownerId, today),
    steps:
      yazioHealthRepository().steps(ownerId, { from: today, to: today })[0]
        ?.steps ?? null,
    nutrition: {
      today: days.find((day) => day.date === today)?.totals ?? null,
      meanCalories: summary.nutrients.calories.mean,
      recordedDays: summary.recordedDays,
      confirmedDays: summary.nutrients.calories.confirmedDays,
      partialDays: summary.nutrients.calories.partialDays,
    },
    weight: {
      latest: latestRow
        ? { date: latestRow.date, value: weight(latestRow)! }
        : null,
      points,
    },
    workouts: { planned: planned ?? null, completed: completed ?? null },
  };
  if (role === 'OWNER') {
    const access = await authorize(headers, 'yazio:manage', ownerId);
    if (!access.ok) throw new OverviewError(access.status);
    const schedule = getNutritionSchedule(ownerId);
    const sync = nutritionRepository().status(ownerId);
    data.sync = {
      running: schedule.running,
      lastSuccess:
        schedule.lastSuccess ??
        (sync.state === 'completed' ? sync.finishedAt : null),
      hasError:
        schedule.lastError !== null ||
        sync.state === 'failed' ||
        sync.state === 'partial',
    };
  }
  if ((await check()) !== 'OWNER') delete data.sync;
  return data;
}
