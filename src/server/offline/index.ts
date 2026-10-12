import 'server-only';
import { createHmac } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { readTransformMateOfflineBinding } from '@/server/transformmate/token-store';
import { readImage } from '@/server/nutrition/images';
import {
  offlineIdentitySchema,
  offlineLimits,
  offlinePeriodSchema,
  offlineSnapshotSchema,
  type OfflineIdentity,
} from '@/contracts/offline';
import { offlineRepository } from './repository';
import { OfflineError } from './errors';

type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>;
function checkSession(
  session: Session | null,
  expected?: Session,
): asserts session is Session {
  if (!session || new Date(session.session.expiresAt).getTime() <= Date.now())
    throw new OfflineError(401, 'OFFLINE_ACCESS_DENIED');
  if (
    session.user.role !== 'OWNER' ||
    (expected &&
      (session.user.id !== expected.user.id ||
        session.session.id !== expected.session.id))
  )
    throw new OfflineError(403, 'OFFLINE_ACCESS_DENIED');
}
async function guard(headers: Headers, expected: Session) {
  for (const permission of [
    'nutrition:read',
    'measurements:read',
    'workouts:read',
  ] as const) {
    const access = await authorize(headers, permission, expected.user.id);
    if (!access.ok)
      throw new OfflineError(access.status, 'OFFLINE_ACCESS_DENIED');
    checkSession(access.session, expected);
  }
}
async function owner(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  checkSession(session);
  await guard(headers, session);
  return session;
}
function hash(secret: string, purpose: string, values: unknown[]) {
  return createHmac('sha256', secret)
    .update(JSON.stringify([purpose, ...values]))
    .digest('base64url');
}
function config() {
  const env = readServerEnv();
  if (!env.BETTER_AUTH_SECRET)
    throw new OfflineError(503, 'OFFLINE_UNAVAILABLE');
  const path = resolve(env.TRANSFORMMATE_TOKEN_FILE);
  for (const unsafe of [resolve('public'), resolve(env.UPLOADS_DIR)])
    if (path === unsafe || path.startsWith(unsafe + sep))
      throw new OfflineError(503, 'OFFLINE_UNAVAILABLE');
  return { secret: env.BETTER_AUTH_SECRET, path };
}
async function identityContext(headers: Headers, session: Session) {
  const { secret, path } = config();
  const tm = await readTransformMateOfflineBinding(
    path,
    session.user.id,
    secret,
  );
  await guard(headers, session);
  const repo = offlineRepository();
  const epoch = repo.generation(session.user.id);
  const now = Date.now();
  const sessionExpires = new Date(session.session.expiresAt).getTime();
  const identity: OfflineIdentity = offlineIdentitySchema.parse({
    contractVersion: 1,
    partition: hash(secret, 'offline-owner/v1', [session.user.id]),
    connectionGeneration: hash(secret, 'offline-connection/v1', [
      session.user.id,
      session.session.id,
      epoch,
      tm.configured,
      tm.connectionId,
    ]),
    role: 'OWNER',
    serverNow: new Date(now).toISOString(),
    sessionExpiresAt: new Date(sessionExpires).toISOString(),
    expiresAt: new Date(
      Math.min(now + offlineLimits.lifetimeMs, sessionExpires),
    ).toISOString(),
  });
  return { identity, repo, secret, epoch };
}
function strictQuery(url: URL, names: string[]) {
  for (const key of url.searchParams.keys())
    if (!names.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  if (names.some((key) => !url.searchParams.has(key)))
    throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
}
export async function offlineIdentity(headers: Headers, url: URL) {
  strictQuery(url, []);
  const session = await owner(headers);
  return (await identityContext(headers, session)).identity;
}
export async function offlineSnapshot(headers: Headers, url: URL) {
  strictQuery(url, ['from', 'to']);
  const period = offlinePeriodSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!period.success) throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  const session = await owner(headers);
  const context = await identityContext(headers, session);
  const { from, to } = period.data;
  const rows = context.repo.read(session.user.id, from, to);
  await guard(headers, session);
  const after = await identityContext(headers, session);
  if (
    after.identity.connectionGeneration !==
    context.identity.connectionGeneration
  )
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
  const key = (purpose: string, id: string) =>
    hash(context.secret, 'offline-record/v1', [session.user.id, purpose, id]);
  const exercise = (value: {
    name: string;
    comment?: string;
    sets: { reps: number; weightKg: number | null }[];
  }) => ({
    name: value.name,
    ...(value.comment === undefined ? {} : { comment: value.comment }),
    sets: value.sets.map(({ reps, weightKg }) => ({ reps, weightKg })),
  });
  const result = offlineSnapshotSchema.safeParse({
    ...after.identity,
    from,
    to,
    diary: rows.diary.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({
        ...meal,
        entries: meal.entries.map((entry) => ({
          key: key('diary', entry.id),
          kind: entry.kind,
          name: entry.name,
          meal: entry.meal,
          diaryDateTime: entry.diaryDateTime,
          amount: entry.amount,
          baseUnit: entry.baseUnit,
          serving: entry.serving,
          servingQuantity: entry.servingQuantity,
          consumedPortions: entry.consumedPortions,
          recipePortions: entry.recipePortions,
          massG: entry.massG,
          volumeMl: entry.volumeMl,
          ingredientMassEstimateG: entry.ingredientMassEstimateG,
          totals: entry.totals,
          issues: entry.issues,
        })),
      })),
    })),
    photos: {
      availability: 'metadata-only',
      items: rows.photos.map((photo) => {
        const id = key('photo', photo.id);
        return {
          ...photo,
          id,
          downloadUrl: `/api/offline/photos/${id}?date=${photo.date}`,
        };
      }),
    },
    measurements: rows.measurements.map(({ id, ...value }) => ({
      ...value,
      key: key('measurement', id),
      source: 'manual',
    })),
    importedWeights: rows.weights.map(({ id, ...value }) => ({
      ...value,
      key: key('weight', id),
      source: 'yazio',
    })),
    dailySteps: rows.steps.map((value) => ({ ...value, source: 'yazio' })),
    plannedWorkouts: rows.plans.flatMap((plan) =>
      plan.data.workouts
        .filter((workout) => workout.date >= from && workout.date <= to)
        .map((workout) => ({
          key: key('planned', plan.id + ':' + workout.id),
          date: workout.date,
          title: workout.title,
          planTitle: plan.data.title,
          planDescription: plan.data.description,
          exercises: workout.exercises.map(exercise),
        })),
    ),
    workoutSessions: rows.sessions.map((session) => ({
      key: key('session', session.id),
      date: session.date,
      title: session.title,
      note: session.note,
      status: session.status,
      exercises: session.exercises.map(exercise),
      planTitle: session.planSnapshot?.planTitle ?? null,
    })),
    transformMateFacts: rows.transformMateFacts.map(
      ({ id, checkedAt, actual }) => ({
        key: key('tm-fact', id),
        date: actual.date,
        title: actual.title,
        checkedAt,
        started: actual.started,
        finished: actual.finished,
        exercises: actual.exercises.map((exercise) => ({
          name: exercise.name,
          comment: exercise.comment,
          sets: exercise.sets.map(({ order, done, metrics }) => ({
            order,
            done,
            metrics: metrics.map(({ name, unit, type, values }) => ({
              name,
              unit,
              type,
              values,
            })),
          })),
        })),
      }),
    ),
  });
  if (!result.success) {
    const overflow = result.error.issues.some(
      (issue) => issue.code === 'too_big',
    );
    throw new OfflineError(
      overflow ? 413 : 503,
      overflow ? 'OFFLINE_LIMIT_EXCEEDED' : 'OFFLINE_UNAVAILABLE',
    );
  }
  const data = result.data;
  if (
    Buffer.byteLength(JSON.stringify(data), 'utf8') > offlineLimits.payloadBytes
  )
    throw new OfflineError(413, 'OFFLINE_LIMIT_EXCEEDED');
  // No awaits after final fence and synchronous projection.
  if (context.repo.generation(session.user.id) !== context.epoch)
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
  return data;
}
export async function offlinePhoto(headers: Headers, url: URL, opaque: string) {
  strictQuery(url, ['date']);
  if (!/^[A-Za-z0-9_-]{43}$/.test(opaque))
    throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  const date = z.iso.date().safeParse(url.searchParams.get('date'));
  if (!date.success) throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  const session = await owner(headers);
  const context = await identityContext(headers, session);
  const find = () =>
    context.repo
      .photoCandidates(session.user.id, date.data)
      .find(
        (photo) =>
          hash(context.secret, 'offline-record/v1', [
            session.user.id,
            'photo',
            photo.id,
          ]) === opaque,
      );
  const photo = find();
  if (!photo) throw new OfflineError(404, 'OFFLINE_UNAVAILABLE');
  const bytes = await readImage(photo.storageKey);
  await guard(headers, session);
  const after = await identityContext(headers, session);
  if (
    after.identity.connectionGeneration !==
      context.identity.connectionGeneration ||
    find()?.storageKey !== photo.storageKey
  )
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new OfflineError(413, 'OFFLINE_LIMIT_EXCEEDED');
  return { bytes, contentType: photo.mime };
}
