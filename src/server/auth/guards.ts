import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { exerciseReturnTo } from '@/lib/exercise-link';
import { eq } from 'drizzle-orm';
import { getAuth } from './index';
import { getDatabase } from '../db';
import { trainerAccess } from '../db/schema';
import { hasPermission, type Permission } from '@/contracts/permissions';
import { getDataSession, isMcpPrincipal } from './data-session';
export async function requireSession() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    const returnTo = exerciseReturnTo(
      requestHeaders.get('x-tempo-exercise-return-to'),
    );
    redirect(
      returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login',
    );
  }
  return session;
}
export async function authorize(
  requestHeaders: Headers,
  permission: Permission,
  ownerId?: string,
) {
  const session = await getDataSession(requestHeaders);
  if (!session) return { ok: false as const, status: 401 };
  if (
    isMcpPrincipal(requestHeaders) &&
    (!ownerId ||
      session.user.role !== 'OWNER' ||
      !(
        (['nutrition:read', 'measurements:read', 'workouts:read'].includes(
          permission,
        ) &&
          'scopes' in session &&
          session.scopes.includes('tempo:read')) ||
        (['workouts:plan', 'workouts:log'].includes(permission) &&
          'scopes' in session &&
          session.scopes.includes('tempo:workouts:write')) ||
        (permission === 'measurements:write' &&
          'scopes' in session &&
          session.scopes.includes('tempo:measurements:write'))
      ))
  )
    return { ok: false as const, status: 403 };
  if (!hasPermission(session.user.role, permission))
    return { ok: false as const, status: 403 };
  if (
    !ownerId &&
    permission !== 'yazio:manage' &&
    permission !== 'transformmate:manage' &&
    permission !== 'trainers:manage'
  )
    return { ok: false as const, status: 403 };
  if (ownerId) {
    if (session.user.role === 'OWNER' && session.user.id !== ownerId)
      return { ok: false as const, status: 403 };
    if (session.user.role === 'TRAINER') {
      const grant = getDatabase()
        .db.select()
        .from(trainerAccess)
        .where(eq(trainerAccess.trainerId, session.user.id))
        .get();
      if (
        grant?.ownerId !== ownerId ||
        (permission.startsWith('anamnesis:') && !grant.anamnesisAccess)
      )
        return { ok: false as const, status: 403 };
    }
  }
  return { ok: true as const, session };
}
