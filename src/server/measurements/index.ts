import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { trainerAccess } from '@/server/db/schema';
import { authorize } from '@/server/auth/guards';
import { hasTrustedOrigin } from '@/server/auth/origin';
import { measurementInputSchema } from '@/contracts/measurements';
import { measurementRepository } from './repository';
import { bodyRepository } from '@/server/yazio/body-repository';
import { withWriteReceipt, WriteConflict } from '@/server/write-receipts';
import { measurementVersion } from './version';
import { runBodySync } from '@/server/yazio/body-runtime';
export class MeasurementError extends Error {
  constructor(public status: number) {
    super('Measurement operation failed');
  }
}
async function check(headers: Headers, ownerId: string, write = false) {
  const result = await authorize(
    headers,
    write ? 'measurements:write' : 'measurements:read',
    ownerId,
  );
  if (!result.ok) throw new MeasurementError(result.status);
  if (!z.string().min(1).max(128).safeParse(ownerId).success)
    throw new MeasurementError(400);
}
export async function listMeasurements(headers: Headers, ownerId: string) {
  await check(headers, ownerId);
  return measurementRepository()
    .list(ownerId)
    .map((record) => ({
      ...record,
      sync: bodyRepository().status(ownerId, record.id),
    }));
}
export async function getMeasurement(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId);
  const record = measurementRepository().find(ownerId, id);
  return record
    ? { ...record, sync: bodyRepository().status(ownerId, id) }
    : null;
}
export async function measurementExists(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  return (await getMeasurement(headers, ownerId, id)) !== null;
}
export async function saveMeasurement(
  headers: Headers,
  ownerId: string,
  input: unknown,
  id?: string,
) {
  await check(headers, ownerId, true);
  const parsed = measurementInputSchema.safeParse(input);
  if (!parsed.success) throw new MeasurementError(400);
  const result = getDatabase().sqlite.transaction(() =>
    persistMeasurement(ownerId, parsed.data, id),
  )();
  void runBodySync(ownerId).catch(() => {});
  return { ...result, sync: bodyRepository().status(ownerId, result.id) };
}
function persistMeasurement(
  ownerId: string,
  data: z.infer<typeof measurementInputSchema>,
  id?: string,
) {
  const repo = measurementRepository();
  const previous = id ? (repo.find(ownerId, id) ?? null) : null;
  const saved = id
    ? repo.update(ownerId, id, data)
    : repo.create(ownerId, data);
  if (!saved) throw new MeasurementError(404);
  bodyRepository().enqueue(ownerId, saved.id, data, previous);
  return saved;
}
export async function saveVersionedMeasurement(
  headers: Headers,
  ownerId: string,
  namespace: string,
  input: { requestId: string; data: unknown; id?: string; version?: string },
) {
  await check(headers, ownerId, true);
  const data = measurementInputSchema.parse(input.data);
  const result = withWriteReceipt(
    ownerId,
    namespace,
    input.requestId,
    input,
    () => {
      if (input.id) {
        const existing = measurementRepository().find(ownerId, input.id);
        if (!existing) throw new MeasurementError(404);
        if (measurementVersion(existing) !== input.version)
          throw new WriteConflict();
      }
      const record = persistMeasurement(ownerId, data, input.id);
      return {
        ...record,
        version: measurementVersion(record),
        sync: bodyRepository().status(ownerId, record.id),
      };
    },
  );
  void runBodySync(ownerId).catch(() => {});
  return result;
}

export async function deleteMeasurement(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId, true);
  getDatabase().sqlite.transaction(() => {
    bodyRepository().detached(ownerId, id);
    if (!measurementRepository().remove(ownerId, id))
      throw new MeasurementError(404);
  })();
}
export function measurementErrorResponse(error: unknown) {
  return Response.json(
    { error: 'Не удалось выполнить операцию с замерами' },
    {
      status:
        error instanceof MeasurementError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 500,
    },
  );
}

export async function measurementOwner(
  headers: Headers,
  userId: string,
  role: string,
) {
  const ownerId =
    role === 'OWNER'
      ? userId
      : getDatabase()
          .db.select()
          .from(trainerAccess)
          .where(eq(trainerAccess.trainerId, userId))
          .get()?.ownerId;
  if (!ownerId) return null;
  await check(headers, ownerId);
  return ownerId;
}

export function checkMeasurementOrigin(request: Request) {
  if (!hasTrustedOrigin(request)) throw new MeasurementError(403);
}

export async function retryMeasurementSync(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId, true);
  if (!measurementRepository().find(ownerId, id))
    throw new MeasurementError(404);
  bodyRepository().retry(ownerId, id);
  void runBodySync(ownerId, [], id).catch(() => {});
  await check(headers, ownerId, true);
  return getMeasurement(headers, ownerId, id);
}

export async function measurementSyncIssues(headers: Headers, ownerId: string) {
  await check(headers, ownerId);
  return bodyRepository().issues(ownerId);
}
