import 'server-only';
import { eq } from 'drizzle-orm';
import { getDataSession } from '@/server/auth/data-session';
import { getDatabase } from '@/server/db';
import { trainerAccess } from '@/server/db/schema';

// Selects the current data subject; handlers must still authorize each operation.
export async function getAccessibleOwnerId(
  headers: Headers,
): Promise<string | null> {
  const session = await getDataSession(headers);
  if (!session) return null;
  if (session.user.role === 'OWNER') return session.user.id;
  if (session.user.role !== 'TRAINER') return null;
  const grant = getDatabase()
    .db.select({ ownerId: trainerAccess.ownerId })
    .from(trainerAccess)
    .where(eq(trainerAccess.trainerId, session.user.id))
    .get();
  return grant?.ownerId ?? null;
}
