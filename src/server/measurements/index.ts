import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { trainerAccess } from '@/server/db/schema';
import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { measurementInputSchema } from '@/contracts/measurements';
import { measurementRepository } from './repository';
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
  return measurementRepository().list(ownerId);
}
export async function getMeasurement(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId);
  return measurementRepository().find(ownerId, id) ?? null;
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
  const repo = measurementRepository();
  const result = id
    ? repo.update(ownerId, id, parsed.data)
    : repo.create(ownerId, parsed.data);
  if (!result) throw new MeasurementError(404);
  return result;
}
export async function deleteMeasurement(
  headers: Headers,
  ownerId: string,
  id: string,
) {
  await check(headers, ownerId, true);
  if (!measurementRepository().remove(ownerId, id))
    throw new MeasurementError(404);
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
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(readServerEnv().BETTER_AUTH_URL).origin)
    throw new MeasurementError(403);
}
