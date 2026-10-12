import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { hasTrustedOrigin } from '@/server/auth/origin';
import { checkMeasurementOrigin } from '@/server/measurements';
import { checkWorkoutOrigin } from '@/server/workouts/http';
import { sameOrigin } from '@/server/nutrition/http';
import { jsonBody } from '@/server/access/http';

afterEach(() => vi.unstubAllEnvs());

function request(origin?: string) {
  vi.stubEnv('BETTER_AUTH_URL', 'https://nutrition.example.test');
  return new Request('http://localhost:3000/api/synthetic', {
    method: 'POST',
    headers: {
      ...(origin ? { origin } : {}),
      'content-type': 'application/json',
      'x-forwarded-host': 'attacker.example.test',
      'x-forwarded-proto': 'https',
    },
    body: '{}',
  });
}

it.each([checkMeasurementOrigin, checkWorkoutOrigin, sameOrigin])(
  'strict wrapper %s accepts HTTPS public origin with internal HTTP URL',
  (check) =>
    expect(() =>
      check(request('https://nutrition.example.test')),
    ).not.toThrow(),
);
it.each([
  undefined,
  'https://attacker.example.test',
  'http://localhost:3000',
  'null',
])('strict wrappers reject %s despite forwarded headers', (origin) => {
  expect(hasTrustedOrigin(request(origin))).toBe(false);
  for (const check of [checkMeasurementOrigin, checkWorkoutOrigin, sameOrigin])
    expect(() => check(request(origin))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
});
it('collaboration preserves its optional-origin contract and rejects foreign origins', async () => {
  await expect(jsonBody(request())).resolves.toEqual({});
  await expect(
    jsonBody(request('https://nutrition.example.test')),
  ).resolves.toEqual({});
  await expect(
    jsonBody(request('https://attacker.example.test')),
  ).rejects.toMatchObject({ status: 403 });
});

// Every explicit application mutation handler; the Better Auth catch-all owns its SDK policy.
const mutations = [
  ['measurements', 'POST'],
  ['measurements/[id]', 'PUT'],
  ['measurements/[id]', 'DELETE'],
  ['workouts/plans', 'POST'],
  ['workouts/plans/[id]', 'PUT'],
  ['workouts/plans/[id]', 'DELETE'],
  ['workouts/sessions', 'POST'],
  ['workouts/sessions/[id]', 'PUT'],
  ['workouts/sessions/[id]', 'DELETE'],
  ['workouts/transformmate', 'POST'],
  ['nutrition/photos', 'POST'],
  ['nutrition/photos/[id]', 'DELETE'],
  ['yazio/connect', 'POST'],
  ['yazio/disconnect', 'POST'],
  ['yazio/sync', 'POST'],
  ['yazio/token', 'POST'],
  ['comments', 'POST'],
  ['comments/[id]', 'PATCH'],
  ['comments/[id]', 'DELETE'],
  ['trainers', 'POST'],
  ['trainers', 'DELETE'],
  ['trainers/invitations', 'POST'],
  ['trainers/invitations/accept', 'POST'],
] as const;

const routes = {
  measurements: () => import('@/app/api/measurements/route'),
  'measurements/[id]': () => import('@/app/api/measurements/[id]/route'),
  'workouts/plans': () => import('@/app/api/workouts/plans/route'),
  'workouts/plans/[id]': () => import('@/app/api/workouts/plans/[id]/route'),
  'workouts/sessions': () => import('@/app/api/workouts/sessions/route'),
  'workouts/sessions/[id]': () =>
    import('@/app/api/workouts/sessions/[id]/route'),
  'workouts/transformmate': () =>
    import('@/app/api/workouts/transformmate/route'),
  'nutrition/photos': () => import('@/app/api/nutrition/photos/route'),
  'nutrition/photos/[id]': () =>
    import('@/app/api/nutrition/photos/[id]/route'),
  'yazio/connect': () => import('@/app/api/yazio/connect/route'),
  'yazio/disconnect': () => import('@/app/api/yazio/disconnect/route'),
  'yazio/sync': () => import('@/app/api/yazio/sync/route'),
  'yazio/token': () => import('@/app/api/yazio/token/route'),
  comments: () => import('@/app/api/comments/route'),
  'comments/[id]': () => import('@/app/api/comments/[id]/route'),
  trainers: () => import('@/app/api/trainers/route'),
  'trainers/invitations': () => import('@/app/api/trainers/invitations/route'),
  'trainers/invitations/accept': () =>
    import('@/app/api/trainers/invitations/accept/route'),
};

it.each(mutations)(
  '%s %s rejects a foreign browser origin before domain operations',
  async (path, method) => {
    const route = await routes[path]();
    const handler = (
      route as Record<
        string,
        (
          request: Request,
          context: { params: Promise<{ id: string }> },
        ) => Promise<Response>
      >
    )[method];
    if (!handler)
      throw new Error(`Missing mutation handler: ${path} ${method}`);
    const response = await handler(request('https://attacker.example.test'), {
      params: Promise.resolve({ id: 'synthetic-id' }),
    });
    expect(response.status).toBe(403);
  },
);
