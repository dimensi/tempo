import { describe, expect, it, vi } from 'vitest';
import { createTransformMateClient } from '@/server/transformmate/client';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { probeTransformMate } from '@/server/transformmate/probe';

vi.mock('server-only', () => ({}));
const token = 'secret-firebase-id-token';
const nextToken = 'next-firebase-id-token';
const baseUrl = 'https://example.test/ipt/api/v1';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const transportHeaders = {
  Accept: 'application/json; version=1.3',
  'Accept-Language': 'ru',
  'User-Agent': '',
};
const provider = () => ({ getIdToken: vi.fn().mockResolvedValue(token) });

describe('TransformMate transport', () => {
  it('does not leak exceptions from an injected token provider', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      createTransformMateClient({
        baseUrl,
        tokenProvider: {
          getIdToken: vi.fn().mockRejectedValue(new Error(token)),
        },
        fetch: request,
      }).getMe(),
    ).rejects.toThrow('TransformMate token acquisition failed');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([baseUrl, `${baseUrl}/`])(
    'keeps API prefix and uses JWT: %s',
    async (base) => {
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => json([]));
      const tokenProvider = provider();
      const client = createTransformMateClient({
        baseUrl: base,
        tokenProvider,
        fetch: request,
      });
      await client.getMe();
      await client.getTrainingsRaw();
      expect(String(request.mock.calls[0]?.[0])).toBe(`${baseUrl}/users/me/`);
      expect(String(request.mock.calls[1]?.[0])).toBe(
        `${baseUrl}/workouts/trainings/`,
      );
      expect(request.mock.calls[0]?.[1]).toMatchObject({
        method: 'GET',
        headers: { ...transportHeaders, Authorization: `JWT ${token}` },
        redirect: 'error',
        cache: 'no-store',
      });
      expect(tokenProvider.getIdToken).toHaveBeenCalledTimes(2);
    },
  );

  it('refreshes once and retries a 401 with the new token', async () => {
    const tokenProvider = {
      getIdToken: vi
        .fn()
        .mockResolvedValueOnce(token)
        .mockResolvedValueOnce(nextToken),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ id: 1 }));
    const result = await createTransformMateClient({
      baseUrl,
      tokenProvider,
      fetch: request,
    }).getMe();
    expect(result.status).toBe(200);
    expect(tokenProvider.getIdToken.mock.calls).toEqual([
      [],
      [{ forceRefresh: true }],
    ]);
    expect(request.mock.calls.map((call) => call[1]?.headers)).toEqual([
      { ...transportHeaders, Authorization: `JWT ${token}` },
      { ...transportHeaders, Authorization: `JWT ${nextToken}` },
    ]);
  });

  it('does not retry a second 401', async () => {
    const tokenProvider = provider();
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ detail: 'expired' }, 401));
    await expect(
      createTransformMateClient({
        baseUrl,
        tokenProvider,
        fetch: request,
      }).getMe(),
    ).rejects.toMatchObject({ name: 'TransformMateApiError', status: 401 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(tokenProvider.getIdToken.mock.calls).toEqual([
      [],
      [{ forceRefresh: true }],
    ]);
  });

  it.each([403, 400, 404, 429, 500])(
    'does not refresh/retry HTTP %s',
    async (status) => {
      const tokenProvider = provider();
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ detail: 'Email address not allowed' }, status),
        );
      await expect(
        createTransformMateClient({
          baseUrl,
          tokenProvider,
          fetch: request,
        }).getMe(),
      ).rejects.toMatchObject({ status });
      expect(tokenProvider.getIdToken.mock.calls).toEqual([[]]);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    json({ detail: token }, 403),
    new Response(`echo ${token}`, { status: 500, statusText: token }),
    new Response('{invalid JSON', {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }),
  ])('returns structured sanitized JSON and text errors', async (response) => {
    const error = await createTransformMateClient({
      baseUrl,
      tokenProvider: provider(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    })
      .getMe()
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TransformMateApiError);
    expect(error).toMatchObject({ status: response.status });
    expect(JSON.stringify(error)).not.toContain(token);
    expect(String(error)).not.toContain(token);
    if (error instanceof TransformMateApiError) {
      expect(error.isJson).toBe(response.status === 403);
      expect(error.body).toEqual(
        response.status === 403
          ? { detail: '[REDACTED]' }
          : response.status === 500
            ? 'echo [REDACTED]'
            : '{invalid JSON',
      );
    }
  });

  it('does not expose fetch exception details', async () => {
    const tokenProvider = provider();
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(token));
    await expect(
      createTransformMateClient({
        baseUrl,
        tokenProvider,
        fetch: request,
      }).getMe(),
    ).rejects.toThrow('TransformMate request or response read failed');
    expect(tokenProvider.getIdToken).toHaveBeenCalledTimes(1);
  });

  it('redacts old/new tokens, unicode escapes and provider secrets from raw logs', async () => {
    const refreshToken = 'private-refresh-credential';
    const encoded = token.replace(
      /./g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    const tokenProvider = {
      getIdToken: vi
        .fn()
        .mockResolvedValueOnce(token)
        .mockResolvedValue(nextToken),
      redact: (text: string) => text.split(refreshToken).join('[REDACTED]'),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(
        new Response(
          `{"${nextToken}":"${encoded}","echo":"${refreshToken}","refresh_token":"unknown-new-secret"}`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(json([]));
    const log = vi.fn();
    const result = await probeTransformMate({
      baseUrl,
      tokenProvider,
      fetch: request,
      log,
      raw: true,
    });
    const output = JSON.stringify({ result, logs: log.mock.calls });
    for (const secret of [token, nextToken, refreshToken, 'unknown-new-secret'])
      expect(output).not.toContain(secret);
    expect(output).toContain('[REDACTED]');
  });

  it('prints the concise probe result and stops if me is rejected', async () => {
    const log = vi.fn();
    const result = await probeTransformMate({
      baseUrl,
      tokenProvider: provider(),
      fetch: vi.fn<typeof fetch>().mockImplementation(async () => json([])),
      log,
    });
    expect(result.scheme).toBe('JWT');
    expect(log.mock.calls.flat()).toEqual([
      'TransformMate /users/me/: 200 (JWT)',
      'TransformMate /workouts/trainings/: 200 (JWT)',
      'trainings: 0',
    ]);
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({}, 403));
    const rejected = await probeTransformMate({
      baseUrl,
      tokenProvider: provider(),
      fetch: request,
      log: vi.fn(),
    });
    expect(rejected.trainings).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
