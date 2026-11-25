import 'server-only';
import { recoveryRangeSchema } from '@/contracts/recovery';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { authorize } from '@/server/auth/guards';
import { readHealthAutoExportSamples } from '@/server/health-auto-export/repository';
import { projectRecovery } from './projection';

const sampleLimit = 200_000;

export class RecoveryReadError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 422) {
    super('Recovery data unavailable');
  }
}

async function check(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'recovery:read', ownerId);
  if (!access.ok)
    throw new RecoveryReadError(access.status === 401 ? 401 : 403);
  if (access.session.user.role !== 'OWNER') throw new RecoveryReadError(403);
}

export async function getRecovery(
  headers: Headers,
  ownerId: string,
  input: unknown,
) {
  await check(headers, ownerId);
  const parsed = recoveryRangeSchema.safeParse(input);
  if (!parsed.success) throw new RecoveryReadError(400);
  const range = parsed.data;
  // Allow overnight intervals and calendar boundaries that differ from the export offset.
  const samples = readHealthAutoExportSamples(
    ownerId,
    { from: shiftDate(range.from, -2), to: shiftDate(range.to, 2) },
    { limit: sampleLimit + 1 },
  );
  if (samples.length > sampleLimit) throw new RecoveryReadError(422);
  const result = projectRecovery(range, samples);
  await check(headers, ownerId);
  return result;
}
