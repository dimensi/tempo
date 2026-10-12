import 'server-only';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { user, account, trainerAccess } from '@/server/db/schema';
import { trainerInvitations } from '@/server/db/schema/trainer-invitations';
import {
  inviteInput,
  acceptInviteInput,
  grantInput,
} from '@/contracts/trainers';
import { CollaborationError } from './http';
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
async function owner(headers: Headers, ownerId: string) {
  const auth = await authorize(headers, 'trainers:manage', ownerId);
  if (!auth.ok) throw new CollaborationError(auth.status);
  return auth.session;
}
export async function createInvitation(headers: Headers, raw: unknown) {
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) throw new CollaborationError(400);
  const input = parsed.data;
  await owner(headers, input.ownerId);
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  getDatabase()
    .db.insert(trainerInvitations)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      email: input.email,
      tokenHash: digest(token),
      expiresAt: now + 86400000,
      createdAt: now,
    })
    .run();
  return { token, expiresAt: new Date(now + 86400000).toISOString() };
}
// This public entry is authorized by a one-use invitation capability, never by a submitted role.
export async function acceptInvitation(raw: unknown) {
  const parsed = acceptInviteInput.safeParse(raw);
  if (!parsed.success)
    throw new CollaborationError(400, 'INVITE_INVALID_INPUT');
  const input = parsed.data;
  const db = getDatabase().db;
  const hash = digest(input.token);
  const now = Date.now();
  const invitation = db
    .select()
    .from(trainerInvitations)
    .where(
      and(
        eq(trainerInvitations.tokenHash, hash),
        isNull(trainerInvitations.consumedAt),
        gt(trainerInvitations.expiresAt, now),
      ),
    )
    .get();
  if (!invitation) throw new CollaborationError(400, 'INVITE_UNAVAILABLE');
  const password = await hashPassword(input.password);
  const id = randomUUID();
  db.transaction((tx) => {
    const acceptedAt = Date.now();
    const claimed = tx
      .update(trainerInvitations)
      .set({ consumedAt: acceptedAt })
      .where(
        and(
          eq(trainerInvitations.id, invitation.id),
          isNull(trainerInvitations.consumedAt),
          gt(trainerInvitations.expiresAt, acceptedAt),
        ),
      )
      .returning()
      .get();
    if (!claimed) throw new CollaborationError(400, 'INVITE_UNAVAILABLE');
    if (
      tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, claimed.email))
        .get()
    )
      throw new CollaborationError(409, 'INVITE_ACCOUNT_EXISTS');
    const timestamp = new Date(acceptedAt);
    tx.insert(user)
      .values({
        id,
        name: input.name,
        email: claimed.email,
        role: 'TRAINER',
        emailVerified: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(account)
      .values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    tx.insert(trainerAccess)
      .values({ trainerId: id, ownerId: claimed.ownerId, createdAt: timestamp })
      .run();
  });
  return { accepted: true };
}
export async function setTrainerGrant(
  headers: Headers,
  raw: unknown,
  enabled: boolean,
) {
  const parsed = grantInput.safeParse(raw);
  if (!parsed.success) throw new CollaborationError(400);
  const input = parsed.data;
  await owner(headers, input.ownerId);
  const db = getDatabase().db;
  const trainer = db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, input.trainerId))
    .get();
  if (trainer?.role !== 'TRAINER') throw new CollaborationError(400);
  if (enabled)
    db.insert(trainerAccess)
      .values({
        trainerId: input.trainerId,
        ownerId: input.ownerId,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trainerAccess.trainerId,
        set: { ownerId: input.ownerId, createdAt: new Date() },
      })
      .run();
  else
    db.delete(trainerAccess)
      .where(
        and(
          eq(trainerAccess.trainerId, input.trainerId),
          eq(trainerAccess.ownerId, input.ownerId),
        ),
      )
      .run();
  return { granted: enabled };
}
export async function listTrainers(headers: Headers, ownerId: string) {
  if (!ownerId) throw new CollaborationError(400);
  await owner(headers, ownerId);
  return getDatabase()
    .db.select({
      id: user.id,
      name: user.name,
      email: user.email,
      grantOwnerId: trainerAccess.ownerId,
    })
    .from(user)
    .leftJoin(trainerAccess, eq(user.id, trainerAccess.trainerId))
    .where(eq(user.role, 'TRAINER'))
    .all()
    .map(({ grantOwnerId, ...trainer }) => ({
      ...trainer,
      granted: grantOwnerId === ownerId,
    }));
}
