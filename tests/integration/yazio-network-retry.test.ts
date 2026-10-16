import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { nutritionUpstream } from '@/server/yazio/adapter';

test('SDK read recovery shares a bounded retry sequence without replaying HTTP denials or OAuth', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const timeout = () =>
    new TypeError('fetch failed private-url?token=secret', {
      cause: Object.assign(new Error('private socket details'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });
  const store = (expired = false) => ({
    load: async () => ({
      token_type: 'Bearer',
      access_token: 'synthetic-access-secret',
      refresh_token: 'synthetic-refresh-secret',
      expires_in: 3600,
      expires_at: expired ? 0 : Date.now() + 3600000,
    }),
    save: vi.fn(async () => {}),
    assertCurrent: vi.fn(async () => {}),
  });
  const meals = Object.fromEntries(
    ['breakfast', 'lunch', 'dinner', 'snack'].map((kind) => [
      kind,
      { nutrients: {} },
    ]),
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(timeout())
    .mockImplementation(async () => Response.json({ meals, steps: 0 }));
  const settle = async <T>(promise: Promise<T>) => {
    const result = promise.then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    await vi.runAllTimersAsync();
    return result;
  };
  try {
    const source = await nutritionUpstream(store());
    const recovered = await settle(
      Promise.all([
        source.summary('2026-10-12'),
        source.healthSummary('2026-10-12'),
      ]),
    );
    expect(recovered.error).toBeUndefined();
    expect(recovered.value?.[0].meals).toEqual(meals);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'yazio_read_retry',
      expect.objectContaining({
        operation: 'summary',
        code: 'UND_ERR_CONNECT_TIMEOUT',
        attempt: 1,
        delayMs: 500,
      }),
    );
    expect(info).toHaveBeenCalledWith(
      'yazio_read_recovered',
      expect.objectContaining({ attempts: 2 }),
    );

    fetch.mockClear().mockRejectedValue(timeout());
    const failed = await settle(source.summary('2026-10-11'));
    expect(failed.error).toMatchObject({ message: 'YAZIO request failed' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      'yazio_read_failed',
      expect.objectContaining({ code: 'UND_ERR_CONNECT_TIMEOUT', attempt: 3 }),
    );
    await settle(source.healthSummary('2026-10-11'));
    expect(fetch).toHaveBeenCalledTimes(3);

    fetch
      .mockClear()
      .mockImplementation(async () => new Response('{}', { status: 403 }));
    expect((await settle(source.summary('2026-10-10'))).error).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'yazio_read_failed',
      expect.objectContaining({ category: 'HTTP', status: 403, attempt: 1 }),
    );

    fetch.mockClear().mockRejectedValue(timeout());
    const expired = store(true);
    expect(
      (await settle((await nutritionUpstream(expired)).summary('2026-10-09')))
        .error,
    ).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(expired.save).not.toHaveBeenCalled();
    const logs = JSON.stringify([warn.mock.calls, info.mock.calls]);
    expect(logs).not.toMatch(/secret|private|https?:\/\//);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
