import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirebaseSession } from '@/server/transformmate/firebase-session';
import { FirebaseRefreshError } from '@/server/transformmate/errors';

vi.mock('server-only', () => ({}));
afterEach(() => vi.restoreAllMocks());
const apiKey = 'firebase-api-configuration';
const refreshToken = 'refresh+secret/&=value';
const idToken = 'firebase-id-secret';
const refreshed = 'rotated-refresh-secret';
const payload = (overrides: Record<string, unknown> = {}) => ({
  expires_in: '3600',
  token_type: 'Bearer',
  refresh_token: refreshToken,
  id_token: idToken,
  user_id: 'firebase-user',
  project_id: 'firebase-project',
  ...overrides,
});
const response = (body: unknown = payload(), status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const session = (
  request: typeof fetch,
  onRefreshToken?: (token: string) => Promise<void> | void,
) =>
  new FirebaseSession({
    firebaseApiKey: apiKey,
    refreshToken,
    fetch: request,
    onRefreshToken,
  });

describe('Firebase session', () => {
  it('refreshes without a token using the correct form-urlencoded request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response());
    const firebase = session(request);
    expect(await firebase.getIdToken()).toBe(idToken);
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
      cache: 'no-store',
    });
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual(
      { grant_type: 'refresh_token', refresh_token: refreshToken },
    );
    expect(firebase.getSessionInfo()).toMatchObject({
      expiresIn: 3600,
      userId: 'firebase-user',
      projectId: 'firebase-project',
      refreshTokenRotated: false,
    });
  });

  it.each([61, 60, 59, 0, -1])(
    'uses cache only with >60 seconds remaining (%s)',
    async (remaining) => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => response());
      const firebase = session(request);
      await firebase.getIdToken();
      now.mockReturnValue(4_600_000 - remaining * 1000);
      await firebase.getIdToken();
      expect(request).toHaveBeenCalledTimes(remaining > 60 ? 1 : 2);
    },
  );

  it('forceRefresh refreshes even with a valid cached ID token', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(payload({ id_token: 'new-id-secret' })));
    const firebase = session(request);
    await firebase.getIdToken();
    expect(await firebase.getIdToken({ forceRefresh: true })).toBe(
      'new-id-secret',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('accepts rotation, calls persistence callback and uses the new refresh token next time', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(payload({ refresh_token: refreshed })),
      );
    const onRefreshToken = vi.fn(async () => {});
    const firebase = session(request, onRefreshToken);
    await firebase.getIdToken();
    expect(firebase.getRefreshToken()).toBe(refreshed);
    expect(onRefreshToken).toHaveBeenCalledWith(refreshed);
    expect(firebase.getSessionInfo()?.refreshTokenRotated).toBe(true);
    await firebase.getIdToken({ forceRefresh: true });
    expect(
      new URLSearchParams(String(request.mock.calls[1]?.[1]?.body)).get(
        'refresh_token',
      ),
    ).toBe(refreshed);
    expect(onRefreshToken).toHaveBeenCalledTimes(1);
    expect(firebase.getSessionInfo()?.refreshTokenRotated).toBe(true);
  });

  it('keeps the current refresh token if Firebase omits rotation', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(payload({ refresh_token: undefined })));
    const callback = vi.fn();
    const firebase = session(request, callback);
    await firebase.getIdToken();
    expect(firebase.getRefreshToken()).toBe(refreshToken);
    expect(callback).not.toHaveBeenCalled();
  });

  it('coalesces concurrent refreshes and clears the pending request after failure', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(refreshToken))
      .mockImplementation(async () => response());
    const firebase = session(request);
    const failed = await Promise.allSettled([
      firebase.getIdToken(),
      firebase.getIdToken(),
    ]);
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await Promise.all([firebase.getIdToken(), firebase.getIdToken()]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    'INVALID_REFRESH_TOKEN',
    'TOKEN_EXPIRED',
    'USER_DISABLED',
    'USER_NOT_FOUND',
    'PROJECT_NUMBER_MISMATCH',
  ])('preserves HTTP and Firebase error code %s', async (code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          error: {
            code: 400,
            message: `${code} : ${refreshToken} ${apiKey}`,
          },
          id_token: idToken,
        },
        400,
      ),
    );
    const error = await session(request)
      .getIdToken()
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(FirebaseRefreshError);
    expect(error).toMatchObject({ code, status: 400 });
    for (const secret of [refreshToken, apiKey, idToken])
      expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error)).toContain(code);
  });

  it('distinguishes invalid API key errors', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          error: {
            message: 'API key not valid. Please pass a valid API key.',
          },
        },
        400,
      ),
    );
    await expect(session(request).getIdToken()).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
      status: 400,
    });
  });

  it('sanitizes non-JSON errors and network failures', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(`error ${encodeURIComponent(refreshToken)} ${apiKey}`, {
          status: 502,
        }),
      )
      .mockRejectedValueOnce(new Error(`${refreshToken} ${apiKey}`));
    const firebase = session(request);
    const error = await firebase.getIdToken().catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'UNKNOWN_ERROR',
      status: 502,
      body: 'error [REDACTED] [REDACTED]',
    });
    await expect(firebase.getIdToken()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: null,
      body: null,
    });
  });

  it.each([
    { expires_in: 'NaN' },
    { expires_in: '0' },
    { expires_in: '1.5' },
    { id_token: '' },
    { id_token: 'bad token' },
    { refresh_token: 42 },
    { user_id: null },
  ])(
    'rejects malformed response %j without leaking payload',
    async (change) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(payload(change)));
      const error = await session(request)
        .getIdToken()
        .catch((value: unknown) => value);
      expect(error).toMatchObject({
        code: 'INVALID_RESPONSE',
        status: 200,
        body: null,
      });
      expect(JSON.stringify(error)).not.toContain(idToken);
    },
  );

  it('protects inspection and sanitizes a failing persistence callback', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(payload({ refresh_token: refreshed })));
    const firebase = session(request, () => {
      throw new Error(refreshed);
    });
    const error = await firebase.getIdToken().catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'PERSISTENCE_CALLBACK_FAILED' });
    for (const secret of [refreshed, refreshToken, idToken, apiKey]) {
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(JSON.stringify(firebase)).not.toContain(secret);
    }
  });
});
