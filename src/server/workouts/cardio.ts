import 'server-only';
import type { CardioCommand } from '@/contracts/cardio-workouts';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { withWriteReceipt } from '@/server/write-receipts';
import { WorkoutAccessError } from './index';
import { cardioRepository } from './cardio-repository';

export async function requireCardioAccess(
  headers: Headers,
  ownerId: string,
  write = false,
) {
  const access = await authorize(
    headers,
    write ? 'workouts:log' : 'workouts:read',
    ownerId,
  );
  if (!access.ok || (write && access.session.user.role !== 'OWNER'))
    throw new WorkoutAccessError(access.ok ? 403 : access.status);
}

export async function executeCardioCommand(
  headers: Headers,
  ownerId: string,
  namespace: string,
  command: CardioCommand,
) {
  await requireCardioAccess(headers, ownerId, true);
  return withWriteReceipt(
    ownerId,
    namespace + ':cardio',
    command.input.requestId,
    command,
    () => cardioRepository(getDatabase().db).mutate(ownerId, command),
  );
}
