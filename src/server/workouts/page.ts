import 'server-only';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { requireSession, authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { trainerAccess } from '@/server/db/schema';

export async function workoutsPageAccess() {
  const session = await requireSession();
  const ownerId =
    session.user.role === 'OWNER'
      ? session.user.id
      : getDatabase()
          .db.select()
          .from(trainerAccess)
          .where(eq(trainerAccess.trainerId, session.user.id))
          .get()?.ownerId;
  if (!ownerId) return null;
  const result = await authorize(await headers(), 'workouts:read', ownerId);
  if (!result.ok) return null;
  return { ownerId, canLog: session.user.role === 'OWNER' };
}
