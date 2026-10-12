import { describe, expect, it, vi } from 'vitest';
import { createTransformMateClient } from '@/server/transformmate/client';
import { transformMateExerciseDetailSchema } from '@/server/transformmate/exercise-schema';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
vi.mock('server-only', () => ({}));
const token = 'private-test-token';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function setup(...responses: Response[]) {
  const provider = { getIdToken: vi.fn().mockResolvedValue(token) };
  const request = vi.fn<typeof fetch>();
  for (const response of responses) request.mockResolvedValueOnce(response);
  return {
    request,
    provider,
    client: createTransformMateClient({
      baseUrl: 'https://example.test/ipt/api/v1',
      tokenProvider: provider,
      fetch: request,
    }),
  };
}
describe('exercise detail and media', () => {
  it('returns typed detail, preserving video URLs/qualities and unknown fields', async () => {
    const body = { ...exerciseDetailFixture(), future: { value: 1 } };
    const { client, request } = setup(json(body));
    expect((await client.getExercise(501)).body).toEqual(body);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      'https://example.test/ipt/api/v1/exercises/501/',
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: `JWT ${token}`,
        Accept: 'application/json; version=1.3',
        'Accept-Language': 'ru',
        'User-Agent': 'yazio-dashboard (TransformMate integration)',
      },
    });
    const headers = request.mock.calls[0]?.[1]?.headers;
    expect(headers).not.toHaveProperty('adid');
    expect(headers).not.toHaveProperty('idfa');
    expect(headers).not.toHaveProperty('app_version');
    expect(request).toHaveBeenCalledTimes(1); // Does not download any media.
  });
  it('accepts missing media represented by nulls or empty arrays, and Vimeo IDs', () => {
    const body = exerciseDetailFixture();
    for (const kinescope_data of [null, []])
      expect(
        transformMateExerciseDetailSchema.parse({
          ...body,
          image: null,
          video_link: null,
          youtube_link: null,
          vimeo_link: '12345',
          kinescope_data,
        }).vimeo_link,
      ).toBe('12345');
  });
  it('accepts a null muscle position and equipment groups with nested equipment', () => {
    const body = exerciseDetailFixture();
    const parsed = transformMateExerciseDetailSchema.parse({
      ...body,
      muscles: body.muscles.map((muscle) => ({ ...muscle, position: null })),
      equipments: [
        {
          id: 97,
          name: 'Demo',
          equipment_group: null,
          equipment_groups: [
            {
              id: 2,
              name: 'Demo group',
              equipments: [{ id: 3, name: 'Demo equipment' }],
            },
          ],
        },
      ],
    });
    expect(parsed.muscles[0]?.position).toBeNull();
    expect(parsed.equipments[0]?.equipment_groups[0]?.equipments[0]?.id).toBe(
      3,
    );
  });
  it('accepts nullable APK video fields but rejects numeric URLs/resolutions', () => {
    const body = exerciseDetailFixture();
    expect(
      transformMateExerciseDetailSchema.safeParse({
        ...body,
        kinescope_data: [{ id: null, url: null, resolution: null }],
      }).success,
    ).toBe(true);
    expect(
      transformMateExerciseDetailSchema.safeParse({
        ...body,
        kinescope_data: [{ id: 'demo', url: 123, resolution: 720 }],
      }).success,
    ).toBe(false);
  });
  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe ID %s without a request',
    (id) => {
      const { client, request } = setup();
      expect(() => client.getExercise(id)).toThrow(
        'Invalid TransformMate exercise ID',
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('rejects short catalog responses and sanitizes validation errors', async () => {
    const { client } = setup(json({ id: 501, name: token }));
    const error = await client
      .getExercise(501)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: 'TransformMateResponseError',
      endpoint: 'exercises/501/',
    });
    expect(JSON.stringify(error)).not.toContain(token);
  });
  it('refreshes exactly once on 401 and preserves request headers on retry', async () => {
    const { client, provider, request } = setup(
      json({}, 401),
      json(exerciseDetailFixture()),
    );
    provider.getIdToken
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce('new-test-token');
    await client.getExercise(501);
    expect(provider.getIdToken.mock.calls).toEqual([
      [],
      [{ forceRefresh: true }],
    ]);
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'JWT new-test-token',
      Accept: 'application/json; version=1.3',
    });
  });
  it.each([403, 404, 500])(
    'does not retry HTTP %s and redacts credentials',
    async (status) => {
      const { client, provider, request } = setup(
        json({ detail: token, refresh_token: 'other-private-token' }, status),
      );
      const error = await client
        .getExercise(501)
        .catch((value: unknown) => value);
      expect(error).toMatchObject({ status });
      expect(JSON.stringify(error)).not.toContain(token);
      expect(JSON.stringify(error)).not.toContain('other-private-token');
      expect(provider.getIdToken.mock.calls).toEqual([[]]);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it('redacts credentials echoed in successful added fields', async () => {
    const { client } = setup(
      json({
        ...exerciseDetailFixture(),
        debug: token,
        access_token: 'unrecognized-credential',
      }),
    );
    const result = await client.getExercise(501);
    expect(result.body.debug).toBe('[REDACTED]');
    expect(result.body.access_token).toBe('[REDACTED]');
  });
});
