import 'server-only';
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
  // Indexed date window, and one latest weight record; never load historical measurements for a month chart.
  const weightRows = sqlite
    .prepare(
      `SELECT measured_at as date, values_json as valuesJson FROM measurements WHERE owner_id = ? AND measured_at >= ? AND measured_at <= ? ORDER BY measured_at, id`,
    )
    .all(ownerId, shiftDate(today, -29), today) as Array<{
    date: string;
    valuesJson: string;
  }>;
  const latestRow = sqlite
    .prepare(
      `SELECT measured_at as date, values_json as valuesJson FROM measurements WHERE owner_id = ? AND measured_at <= ? AND EXISTS (SELECT 1 FROM json_each(values_json) WHERE json_extract(value, '$.metric') = 'weight') ORDER BY measured_at DESC, id DESC LIMIT 1`,
    )
    .get(ownerId, today) as { date: string; valuesJson: string } | undefined;
  const weight = (row: { date: string; valuesJson: string }) =>
    (
      JSON.parse(row.valuesJson) as Array<{ metric: string; value: string }>
    ).find((value) => value.metric === 'weight')?.value ?? null;
  const byDate = new Map(
    weightRows.flatMap((row) => {
      const value = weight(row);
      return value === null ? [] : [[row.date, value] as const];
    }),
  );
  const points = Array.from({ length: 30 }, (_, i) => {
    const date = shiftDate(today, i - 29);
    return { date, value: byDate.get(date) ?? null };
  });
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
      running: schedule.running || sync.state === 'running',
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
