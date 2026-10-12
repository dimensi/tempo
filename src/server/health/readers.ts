import 'server-only';
import Decimal from 'decimal.js';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { measurementRepository } from '@/server/measurements/repository';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { ownerConfirmedYazioWeightUnit } from '@/contracts/yazio-weight-policy';
import {
  healthRangeSchema,
  healthRangeDates,
  stepsSummarySchema,
  weightHistorySchema,
  type HealthRange,
} from '@/contracts/health';

const HealthDecimal = Decimal.clone({ precision: 40 });
export class HealthReadError extends Error {
  constructor(public readonly status: number) {
    super('Health data unavailable');
  }
}
async function check(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'measurements:read', ownerId);
  if (!access.ok) throw new HealthReadError(access.status);
}
async function selectScope(headers: Headers, input: unknown) {
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) {
    const session = await getAuth().api.getSession({ headers });
    throw new HealthReadError(session ? 403 : 401);
  }
  await check(headers, ownerId);
  const parsed = healthRangeSchema.safeParse(input);
  if (!parsed.success) throw new HealthReadError(400);
  return { ownerId, range: parsed.data };
}
export async function getStepsSummary(headers: Headers, input: unknown) {
  const { ownerId, range } = await selectScope(headers, input);
  const records = yazioHealthRepository().steps(ownerId, range);
  await check(headers, ownerId);
  const byDate = new Map(records.map((record) => [record.date, record]));
  const days = healthRangeDates(range).map((date) => ({
    date,
    steps: byDate.get(date)?.steps ?? null,
    source: byDate.has(date) ? ('YAZIO' as const) : null,
  }));
  const observed = days.filter((day) => day.steps !== null);
  const total = observed.reduce(
    (sum, day) => sum.plus(day.steps!),
    new HealthDecimal(0),
  );
  return stepsSummarySchema.parse({
    range,
    days,
    observedDays: observed.length,
    totalSteps: observed.length ? total.toFixed() : null,
    averageSteps: observed.length ? total.div(observed.length).toFixed() : null,
  });
}
export async function getWeightHistory(headers: Headers, input: unknown) {
  const { ownerId, range } = await selectScope(headers, input);
  const imported = yazioHealthRepository().weights(ownerId, range);
  const measurements = measurementRepository().listPeriod(ownerId, range);
  await check(headers, ownerId);
  return weightHistorySchema.parse({
    range,
    local: measurements
      .flatMap((record) =>
        record.values
          .filter((value) => value.metric === 'weight' && value.unit === 'kg')
          .map((value) => ({
            measuredAt: record.measuredAt,
            value: value.value,
            unit: 'kg',
            source: 'LOCAL',
          })),
      )
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
    imported: imported.map((record) => ({
      measuredAt: record.measuredDate,
      rawValue: record.rawValue,
      ...ownerConfirmedYazioWeightUnit,
      source: 'YAZIO',
    })),
  });
}
export function healthRangeFromRequest(request: Request): HealthRange {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => key !== 'from' && key !== 'to') ||
    params.getAll('from').length !== 1 ||
    params.getAll('to').length !== 1
  )
    throw new HealthReadError(400);
  const parsed = healthRangeSchema.safeParse({
    from: params.get('from'),
    to: params.get('to'),
  });
  if (!parsed.success) throw new HealthReadError(400);
  return parsed.data;
}
export function healthErrorResponse(error: unknown) {
  return Response.json(
    { error: 'health_data_unavailable' },
    {
      status: error instanceof HealthReadError ? error.status : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
