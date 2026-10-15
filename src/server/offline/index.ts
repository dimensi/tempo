import { anamnesisRepository } from '@/server/anamnesis/repository';
import 'server-only';
import {
  ownerConfirmedYazioWeightPolicyVersion,
  ownerConfirmedYazioWeightUnit,
} from '@/contracts/yazio-weight-policy';
import { createHmac } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { getAuth } from '@/server/auth';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { readOfflineViews } from './views';
import { getYazioStatus } from '@/server/yazio/settings';
import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import {
  readTransformMateOfflineBinding,
  transformMateOfflineBindingRevision,
} from '@/server/transformmate/token-store';
import { getTransformMateBindingFence } from '@/server/transformmate/runtime';
import { TransformMateStaleConnectionError } from '@/server/transformmate/token-store';
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
    !['OWNER', 'TRAINER'].includes(session.user.role) ||
    (expected &&
      (session.user.id !== expected.user.id ||
        session.session.id !== expected.session.id ||
        session.user.role !== expected.user.role))
  )
    throw new OfflineError(403, 'OFFLINE_ACCESS_DENIED');
}
async function guard(
  headers: Headers,
  expected: Session,
  expectedOwnerId?: string,
) {
  let latest = expected;
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId || (expectedOwnerId && ownerId !== expectedOwnerId)) {
    checkSession(await getAuth().api.getSession({ headers }), expected);
    throw new OfflineError(403, 'OFFLINE_ACCESS_DENIED');
  }
  for (const permission of [
    'nutrition:read',
    'measurements:read',
    'workouts:read',
    'reports:export',
  ] as const) {
    const access = await authorize(headers, permission, ownerId);
    if (!access.ok)
      throw new OfflineError(access.status, 'OFFLINE_ACCESS_DENIED');
    checkSession(access.session, expected);
    latest = {
      ...access.session,
      session: {
        ...access.session.session,
        expiresAt: new Date(
          Math.min(
            new Date(latest.session.expiresAt).getTime(),
            new Date(access.session.session.expiresAt).getTime(),
          ),
        ),
      },
    };
    checkSession(latest, expected);
  }
  return latest;
}
async function owner(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  checkSession(session);
  return guard(headers, session);
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
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) throw new OfflineError(403, 'OFFLINE_ACCESS_DENIED');
  const tm = await readTransformMateOfflineBinding(path, ownerId, secret);
  const nativeBinding = await getTransformMateBindingFence(ownerId);
  try {
    await nativeBinding.assertCurrent();
  } catch (error) {
    if (error instanceof TransformMateStaleConnectionError)
      throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
    throw error;
  }
  session = await guard(headers, session, ownerId);
  const repo = offlineRepository();
  const epoch = repo.generation(ownerId);
  const now = Date.now();
  const sessionExpires = new Date(session.session.expiresAt).getTime();
  const identity: OfflineIdentity = offlineIdentitySchema.parse({
    contractVersion: 2,
    weightPolicyVersion: ownerConfirmedYazioWeightPolicyVersion,
    // OWNER shares the durable write-queue identity; TRAINER remains scoped to its reader and owner.
    partition:
      session.user.role === 'OWNER'
        ? hash(secret, 'offline-owner/v1', [session.user.id])
        : hash(secret, 'offline-reader/v2', [
            session.user.id,
            session.user.role,
            ownerId,
          ]),
    // Reader, role, subject and session bind the current access scope.
    connectionGeneration: hash(secret, 'offline-connection/v1', [
      session.user.id,
      session.user.role,
      ownerId,
      session.session.id,
      epoch,
      tm.configured,
      tm.connectionId,
      ...(session.user.role === 'TRAINER'
        ? [
            [
              ...anamnesisRepository().markerGrantIds(ownerId, session.user.id),
            ].sort(),
            [
              ...anamnesisRepository().documentGrantIds(
                ownerId,
                session.user.id,
              ),
            ].sort(),
          ]
        : []),
    ]),
    role: session.user.role,
    serverNow: new Date(now).toISOString(),
    sessionExpiresAt: new Date(sessionExpires).toISOString(),
    expiresAt: new Date(
      Math.min(now + offlineLimits.lifetimeMs, sessionExpires),
    ).toISOString(),
  });
  const context = {
    identity,
    repo,
    secret,
    epoch,
    path,
    tmRevision: tm.revision,
    connectionId: tm.connectionId,
    ownerId,
    nativeBinding,
    session,
  };
  assertRelease(context);
  return context;
}
function assertRelease(context: {
  repo: ReturnType<typeof offlineRepository>;
  ownerId: string;
  epoch: number;
  path: string;
  tmRevision: number;
  nativeBinding: Awaited<ReturnType<typeof getTransformMateBindingFence>>;
  session: Session;
}) {
  checkSession(context.session);
  try {
    context.nativeBinding.assertBindingCurrent();
  } catch (error) {
    if (error instanceof TransformMateStaleConnectionError)
      throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
    throw error;
  }
  if (
    context.repo.generation(context.ownerId) !== context.epoch ||
    transformMateOfflineBindingRevision(context.path) !== context.tmRevision
  )
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
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
  const context = await identityContext(headers, session);
  assertRelease(context);
  return context.identity;
}
export async function offlineSnapshot(headers: Headers, url: URL) {
  strictQuery(url, ['from', 'to']);
  const period = offlinePeriodSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!period.success) throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  let session = await owner(headers);
  const context = await identityContext(headers, session);
  session = context.session;
  const { from, to } = period.data;
  const rows = context.repo.read(
    context.ownerId,
    from,
    to,
    context.nativeBinding.accountScope,
  );
  const views = readOfflineViews({
    ownerId: context.ownerId,
    role: context.identity.role,
    from,
    to,
    accountScope: context.nativeBinding.accountScope,
    connectionId: context.connectionId,
    transformMateConnected: context.nativeBinding.configured,
    key: (purpose, id) =>
      hash(context.secret, 'offline-record/v1', [context.ownerId, purpose, id]),
  });
  if (views.settings) {
    try {
      const status = await getYazioStatus(headers);
      views.settings.yazioConnected = status.configured;
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? error.status
          : null;
      if (status === 401 || status === 403)
        throw new OfflineError(status, 'OFFLINE_ACCESS_DENIED');
      views.settings = null;
    }
  }
  session = await guard(headers, session, context.ownerId);
  const after = await identityContext(headers, session);
  if (
    after.identity.connectionGeneration !==
    context.identity.connectionGeneration
  )
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
  const key = (purpose: string, id: string) =>
    hash(context.secret, 'offline-record/v1', [context.ownerId, purpose, id]);
  const exercise = (value: {
    name: string;
    comment?: string;
    transformMate?: { occurrenceKey: string };
    sets: { reps: number; weightKg: number | null }[];
  }) => ({
    name: value.name,
    ...(value.transformMate
      ? {
          comparisonKey: key(
            'workout-occurrence',
            value.transformMate.occurrenceKey,
          ),
        }
      : {}),
    ...(value.comment === undefined ? {} : { comment: value.comment }),
    sets: value.sets.map(({ reps, weightKg }) => ({ reps, weightKg })),
  });
  const result = offlineSnapshotSchema.safeParse({
    ...after.identity,
    views,
    from,
    to,
    workoutDates: Array.from(
      {
        length: Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
      },
      (_, index) =>
        new Date(Date.parse(from) + index * 86400000)
          .toISOString()
          .slice(0, 10),
    ),
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
      ...ownerConfirmedYazioWeightUnit,
    })),
    dailySteps: rows.steps.map((value) => ({ ...value, source: 'yazio' })),
    plannedWorkouts: rows.plans.flatMap((plan) =>
      plan.data.workouts
        .filter((workout) => workout.date >= from && workout.date <= to)
        .map((workout) => ({
          key: key('planned', plan.id + ':' + workout.id),
          href: `/workouts/plans/${encodeURIComponent(plan.id)}/workouts/${encodeURIComponent(workout.id)}`,
          date: workout.date,
          title: workout.title,
          planTitle: plan.data.title,
          planDescription: plan.data.description,
          exercises: workout.exercises.map(exercise),
        })),
    ),
    workoutSessions: rows.sessions.map((session) => ({
      key: key('session', session.id),
      href: `/workouts/sessions/${encodeURIComponent(session.id)}`,
      plannedHref:
        session.planId && session.plannedWorkoutId
          ? `/workouts/plans/${encodeURIComponent(session.planId)}/workouts/${encodeURIComponent(session.plannedWorkoutId)}`
          : null,
      planSnapshot: session.planSnapshot
        ? {
            title: session.planSnapshot.planTitle,
            exercises: session.planSnapshot.workout.exercises.map(exercise),
          }
        : null,
      date: session.date,
      title: session.title,
      note: session.note,
      status: session.status,
      exercises: session.exercises.map(exercise),
      planTitle: session.planSnapshot?.planTitle ?? null,
    })),
    nativeTrainings: rows.nativeTrainings.map((training) => ({
      key: key('tm-native', training.id),
      href: `/workouts/native/${training.remoteTrainingId}`,
      source: training.source,
      date: training.date,
      title: training.title,
      progress: training.progress,
      started: training.started,
      finished: training.finished,
      remoteUpdatedAt: training.remoteUpdatedAt,
      fetchedAt: training.fetchedAt,
      exercises: training.exercises.map((exercise) => ({
        protocolOrder: exercise.protocolOrder,
        order: exercise.order,
        name: exercise.name,
        comment: exercise.comment,
        metrics: exercise.metrics.map((group) => ({
          type: group.type,
          sets: group.sets.map((set) => ({
            order: set.order,
            done: set.done,
            metrics: set.metrics.map((metric) => ({
              name: metric.name,
              unit: metric.unit,
              type: metric.type,
              values: metric.values,
            })),
          })),
        })),
      })),
    })),
    transformMateFacts: rows.transformMateFacts.map(
      ({
        id,
        checkedAt,
        actual,
        planId,
        workoutId,
        remoteTrainingId,
        planSnapshot,
      }) => ({
        key: key('tm-fact', id),
        href: `/workouts/links/${encodeURIComponent(id)}`,
        nativeHref:
          remoteTrainingId === null
            ? null
            : `/workouts/native/${remoteTrainingId}`,
        plannedHref: `/workouts/plans/${encodeURIComponent(planId)}/workouts/${encodeURIComponent(workoutId)}`,
        planSnapshot: planSnapshot
          ? {
              title: planSnapshot.planTitle,
              exercises: planSnapshot.workout.exercises.map(exercise),
            }
          : null,
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
  assertRelease(after);
  return data;
}
export async function offlinePhoto(headers: Headers, url: URL, opaque: string) {
  strictQuery(url, ['date']);
  if (!/^[A-Za-z0-9_-]{43}$/.test(opaque))
    throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  const date = z.iso.date().safeParse(url.searchParams.get('date'));
  if (!date.success) throw new OfflineError(400, 'OFFLINE_INVALID_REQUEST');
  let session = await owner(headers);
  const context = await identityContext(headers, session);
  session = context.session;
  const find = () =>
    context.repo
      .photoCandidates(context.ownerId, date.data)
      .find(
        (photo) =>
          hash(context.secret, 'offline-record/v1', [
            context.ownerId,
            'photo',
            photo.id,
          ]) === opaque,
      );
  const photo = find();
  if (!photo) throw new OfflineError(404, 'OFFLINE_UNAVAILABLE');
  const bytes = await readImage(photo.storageKey);
  session = await guard(headers, session, context.ownerId);
  const after = await identityContext(headers, session);
  if (
    after.identity.connectionGeneration !==
      context.identity.connectionGeneration ||
    find()?.storageKey !== photo.storageKey
  )
    throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw new OfflineError(413, 'OFFLINE_LIMIT_EXCEEDED');
  assertRelease(after);
  return { bytes, contentType: photo.mime };
}
