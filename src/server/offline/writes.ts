import 'server-only';
import { createHmac } from 'node:crypto';
import { getAccessibleOwnerId } from '@/server/access/owner';
import type { Permission } from '@/contracts/permissions';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { hasTrustedOrigin } from '@/server/auth/origin';
import { readServerEnv } from '@/server/env';
import { offlineWriteSchema } from '@/contracts/offline-write';
import { bodyRepository } from '@/server/yazio/body-repository';
import { runBodySync } from '@/server/yazio/body-runtime';
import { WorkoutError } from '@/server/workouts/repository';
import { withSessionVideoLock } from '@/server/workouts/videos';
import { syncSavedWorkout } from '@/server/workouts/transformmate/service';
import { workoutRepository } from '@/server/workouts/repository';
import { getDatabase } from '@/server/db';
import { offlineWriteRepository, OfflineWriteError } from './write-repository';
async function identityFor(headers: Headers, permission: Permission) {
  const session = await getAuth().api.getSession({ headers });
  if (!session || new Date(session.session.expiresAt).getTime() <= Date.now())
    throw new OfflineWriteError(401);
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) throw new OfflineWriteError(403);
  const access = await authorize(headers, permission, ownerId);
  if (!access.ok) throw new OfflineWriteError(access.status);
  if (
    !access.session.session ||
    new Date(access.session.session.expiresAt).getTime() <= Date.now() ||
    access.session.session.id !== session.session.id ||
    access.session.user.id !== session.user.id
  )
    throw new OfflineWriteError(403);
  const secret = readServerEnv().BETTER_AUTH_SECRET;
  if (!secret) throw new OfflineWriteError(503);
  const partition = createHmac('sha256', secret)
    .update(
      JSON.stringify(
        session.user.role === 'OWNER'
          ? ['offline-owner/v1', session.user.id]
          : ['offline-reader/v2', session.user.id, session.user.role, ownerId],
      ),
    )
    .digest('base64url');
  return {
    ownerId,
    partition,
    canWriteMeasurements: session.user.role === 'OWNER',
  };
}
export async function readOfflineWrites(headers: Headers) {
  const identity = await identityFor(headers, 'workouts:log');
  const records = offlineWriteRepository().catalog(
    identity.ownerId,
    identity.canWriteMeasurements ? ['measurement', 'workout'] : ['workout'],
  );
  const result = {
    partition: identity.partition,
    yazioEpoch: identity.canWriteMeasurements
      ? (bodyRepository().schedule(identity.ownerId)?.epoch ?? null)
      : null,
    records,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024)
    throw new OfflineWriteError(413);
  return result;
}
export async function saveOfflineWrite(request: Request) {
  if (!hasTrustedOrigin(request)) throw new OfflineWriteError(403);
  const text = await request.text();
  if (Buffer.byteLength(text) > 128 * 1024) throw new OfflineWriteError(413);
  const parsed = offlineWriteSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new OfflineWriteError(400);
  const permission =
    parsed.data.payload.kind === 'measurement'
      ? 'measurements:write'
      : parsed.data.payload.action || parsed.data.payload.feedback
        ? 'workouts:log'
        : 'workouts:plan';
  const identity = await identityFor(request.headers, permission);
  if (identity.partition !== parsed.data.partition)
    throw new OfflineWriteError(403);
  const result =
    parsed.data.payload.kind === 'workout'
      ? await withSessionVideoLock(
          identity.ownerId,
          parsed.data.recordId,
          async () =>
            offlineWriteRepository().apply(identity.ownerId, parsed.data),
        )
      : offlineWriteRepository().apply(identity.ownerId, parsed.data);
  if (parsed.data.payload.kind === 'measurement')
    void runBodySync(identity.ownerId).catch(() => {});
  else if (
    parsed.data.payload.kind === 'workout' &&
    !parsed.data.payload.feedback &&
    result.payload.kind === 'workout'
  ) {
    // Publication is best-effort after commit: a replayed receipt remains valid
    // even when another tab has since deleted the workout.
    await (async () => {
      const workout = workoutRepository(getDatabase().db).get(
        identity.ownerId,
        result.id,
      );
      await syncSavedWorkout(request.headers, identity.ownerId, workout);
    })().catch(() => {});
  }
  return result;
}
export async function offlineWriteResponse(action: () => Promise<unknown>) {
  try {
    return Response.json(await action(), {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json(
      { error: 'OFFLINE_WRITE_FAILED' },
      {
        status:
          error instanceof OfflineWriteError || error instanceof WorkoutError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
      },
    );
  }
}
