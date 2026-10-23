import 'server-only';
import { dailyGoalsRepository } from '@/server/yazio/goals';
import { summarizeSteps } from '@/lib/steps-summary';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { yazioBodyLinks } from '@/server/db/schema/yazio-body';
import { getDatabase } from '@/server/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { measurementRepository } from '@/server/measurements/repository';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { ownerConfirmedYazioWeightUnit } from '@/contracts/yazio-weight-policy';
import {
  healthRangeSchema,
  weightHistorySchema,
  type HealthRange,
} from '@/contracts/health';

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
  return summarizeSteps(
    range,
    records,
    dailyGoalsRepository().list(ownerId, range),
  );
}
export async function getWeightHistory(headers: Headers, input: unknown) {
  const { ownerId, range } = await selectScope(headers, input);
  const linkedIds = new Set(
    getDatabase()
      .db.select({ id: yazioBodyLinks.providerId })
      .from(yazioBodyLinks)
      .where(
        and(
          eq(yazioBodyLinks.ownerId, ownerId),
          eq(yazioBodyLinks.metric, 'weight'),
          isNotNull(yazioBodyLinks.measurementId),
        ),
      )
      .all()
      .map((l) => l.id),
  );
  const imported = yazioHealthRepository()
    .weights(ownerId, range)
    .filter((record) => !linkedIds.has(record.externalId));
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
