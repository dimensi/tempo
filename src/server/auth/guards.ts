import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getAuth } from './index';
import { getDatabase } from '../db';
import { trainerAccess } from '../db/schema';
import { hasPermission, type Permission } from '@/contracts/permissions';
export async function requireSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return session;
}
export async function authorize(
  requestHeaders: Headers,
  permission: Permission,
  ownerId?: string,
) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return { ok: false as const, status: 401 };
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
      if (grant?.ownerId !== ownerId)
        return { ok: false as const, status: 403 };
    }
  }
  return { ok: true as const, session };
}
