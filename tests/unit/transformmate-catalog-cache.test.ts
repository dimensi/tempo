import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  cachedCatalog,
  catalogMatches,
  invalidateTransformMateCatalog,
  rememberExerciseAliases,
  type CatalogScope,
} from '@/server/transformmate/catalog-cache';
import { TransformMateApiError } from '@/server/transformmate/errors';
import { parseRetryAfter } from '@/server/transformmate/retry-after';
import {
  createTransformMateClient,
  type TransformMateClient,
} from '@/server/transformmate/client';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
const list = vi.fn();
const scope: CatalogScope = {
  ownerId: 'cache-test',
  generation: 'first',
  locale: 'ru',
  client: { listExercises: list } as unknown as TransformMateClient,
};
const body = [{ id: 1, name: 'Приседание', metrics: [] }];
beforeEach(() => {
  vi.useRealTimers();
  list.mockReset();
  invalidateTransformMateCatalog(scope.ownerId);
});
it('coalesces concurrent loads and searches locally until TTL expires', async () => {
  vi.useFakeTimers();
  list.mockResolvedValue({ body });
  expect(
    await Promise.all([cachedCatalog(scope), cachedCatalog(scope)]),
  ).toEqual([body, body]);
  await cachedCatalog(scope);
  expect(list).toHaveBeenCalledTimes(1);
  expect(catalogMatches(scope, 1, body[0]!.name, 'прис')).toBe(true);
  vi.advanceTimersByTime(5 * 60_000);
  await cachedCatalog(scope);
  expect(list).toHaveBeenCalledTimes(2);
});
it('isolates accounts and bindings, including client replacement', async () => {
  list.mockResolvedValue({ body });
  await cachedCatalog(scope);
  await cachedCatalog({ ...scope, ownerId: 'another-owner' });
  await cachedCatalog({ ...scope, generation: 'second' });
  const replacement = vi.fn().mockResolvedValue({ body: [] });
  expect(
    await cachedCatalog({
      ...scope,
      client: { listExercises: replacement } as unknown as TransformMateClient,
    }),
  ).toEqual([]);
  expect(list).toHaveBeenCalledTimes(3);
  invalidateTransformMateCatalog('another-owner');
});
it('never caches failures as an empty catalog and bounds 429 cooldown', async () => {
  vi.useFakeTimers();
  list.mockRejectedValueOnce(new Error('network'));
  await expect(cachedCatalog(scope)).rejects.toThrow('network');
  list.mockRejectedValueOnce(
    new TransformMateApiError({
      status: 429,
      statusText: '',
      contentType: '',
      isJson: false,
      body: null,
      retryAfterMs: 999_999,
    }),
  );
  await expect(cachedCatalog(scope)).rejects.toMatchObject({ status: 429 });
  await expect(cachedCatalog(scope)).rejects.toMatchObject({
    status: 429,
    retryAfterMs: 60_000,
  });
  expect(list).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_000);
  list.mockResolvedValue({ body });
  expect(await cachedCatalog(scope)).toEqual(body);
});
it('indexes only real on-demand aliases and clears them on invalidation', async () => {
  list.mockResolvedValue({ body });
  await cachedCatalog(scope);
  const detail = { ...exerciseDetailFixture(), id: 1, other_names: ['Squat'] };
  rememberExerciseAliases(scope, detail);
  expect(catalogMatches(scope, 1, 'Приседание', 'squat')).toBe(true);
  expect(catalogMatches(scope, 1, 'Приседание', 'missing')).toBe(false);
  invalidateTransformMateCatalog(scope.ownerId);
  expect(catalogMatches(scope, 1, 'Приседание', 'squat')).toBe(false);
});
it('parses safe bounded Retry-After metadata', () => {
  expect(parseRetryAfter('10', 0)).toBe(10_000);
  expect(parseRetryAfter('999999', 0)).toBe(60_000);
  expect(parseRetryAfter('secret invalid', 0)).toBe(5_000);
  expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:20 GMT', 0)).toBe(20_000);
});

it('captures only parsed Retry-After and performs one 429 request', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '999999' } }),
    );
  const client = createTransformMateClient({
    baseUrl: 'https://example.test/',
    tokenProvider: { getIdToken: async () => 'synthetic' },
    fetch: request,
  });
  await expect(client.listExercises()).rejects.toMatchObject({
    status: 429,
    retryAfterMs: 60_000,
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![1].headers['Accept-Language']).toBe('ru');
});
