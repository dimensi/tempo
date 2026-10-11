import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Yazio, YazioAuth, type Token } from '@dimensi/yazio';
import { YazioAuth as SubpathAuth } from '@dimensi/yazio/auth';
import { getUserMealImages, UserMealImagesSchema } from '@dimensi/yazio/api';
import { dirname, join } from 'node:path';
const artifactRequire = createRequire(import.meta.url);
// Internal helper is resolved beside the installed package, retaining SDK zod3 isolation.
const { fetchYazio } = artifactRequire(
  join(dirname(artifactRequire.resolve('@dimensi/yazio')), 'sdk.cjs'),
) as { fetchYazio: (...args: Parameters<typeof fetch>) => Promise<unknown> };

// Five mocked SDK-A scenarios ported from upstream tests/meal-images.test.ts.
// Imports target the packaged artifact; no live auth or upstream requests.
const token: Token = {
  token_type: 'Bearer',
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_in: 3600,
  expires_at: Date.now() + 3600000,
};
const fetchSpy = vi.spyOn(globalThis, 'fetch');
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());
const appAgent =
  'YAZIO/26.30.1 (com.yazio.ios.YAZIO; build:2607271240; iOS 27.0.0) Ktor';

test('SDK-A: facade requests date with Bearer and accepted version over v20', async () => {
  fetchSpy.mockResolvedValue(
    new Response(
      JSON.stringify({ lunch: 'https://images.yazio-cdn.com/example.jpg' }),
    ),
  );
  const images = await new Yazio({ token }).user.getMealImages({
    date: '2026-10-09',
  });
  expect(images.lunch).toBe('https://images.yazio-cdn.com/example.jpg');
  const [url, init] = fetchSpy.mock.calls[0]!;
  expect(url).toBe('https://yzapi.yazio.com/v20/user/meal-images/2026-10-09');
  const headers = new Headers(init?.headers);
  expect(headers.get('Authorization')).toBe('Bearer test-access');
  expect(headers.get('User-Agent')).toBe(appAgent);
});
test('SDK-A: empty days, Date inputs, invalid payload and upstream error', async () => {
  fetchSpy.mockResolvedValue(new Response('{}'));
  expect(
    await getUserMealImages(token, { date: new Date('2026-10-10T00:00:00Z') }),
  ).toEqual({});
  expect(fetchSpy.mock.calls[0]![0]).toBe(
    'https://yzapi.yazio.com/v20/user/meal-images/2026-10-10',
  );
  expect(
    UserMealImagesSchema.safeParse({ lunch: ['https://example.com/image.jpg'] })
      .success,
  ).toBe(false);
  fetchSpy.mockResolvedValue(
    new Response('{"error":"version_blocked"}', { status: 403 }),
  );
  await expect(getUserMealImages(token)).rejects.toThrow('403');
});
test('SDK-A: header merging preserves Headers and caller User-Agent', async () => {
  fetchSpy.mockResolvedValue(new Response('{}'));
  await fetchYazio('/user', {
    headers: new Headers({
      Authorization: 'Bearer custom',
      'User-Agent': 'custom-agent',
    }),
  });
  const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
  expect(headers.get('Authorization')).toBe('Bearer custom');
  expect(headers.get('User-Agent')).toBe('custom-agent');
});
test('SDK-A: login and refresh use v22 mobile OAuth without live authentication', async () => {
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify(token)));
  await new YazioAuth({
    credentials: { username: 'example@example.com', password: 'test' },
  }).authenticate();
  await new YazioAuth({ token: { ...token, expires_at: 0 } }).authenticate();
  expect(fetchSpy.mock.calls).toHaveLength(2);
  for (const [url, init] of fetchSpy.mock.calls) {
    expect(url).toBe('https://yzapi.yazio.com/v22/oauth/token');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/json',
    );
    expect(new Headers(init?.headers).get('User-Agent')).toBe(appAgent);
    expect(JSON.parse(init?.body as string).client_id).toBe(
      '3_5rbw4kehpugw8ogsc8ck8oo4ogswgckcskc04gcg8kk8k48ssw',
    );
  }
  expect(
    JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string).grant_type,
  ).toBe('password');
  expect(
    JSON.parse(fetchSpy.mock.calls[1]![1]?.body as string).grant_type,
  ).toBe('refresh_token');
});
test('SDK-A: rejected legacy refresh falls back to credentials', async () => {
  fetchSpy
    .mockResolvedValueOnce(new Response('{}', { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(token)));
  const auth = new YazioAuth({
    token: { ...token, expires_at: 0 },
    credentials: { username: 'example@example.com', password: 'test' },
  });
  expect((await auth.authenticate()).access_token).toBe(token.access_token);
  expect(fetchSpy.mock.calls).toHaveLength(2);
});
test('ESM/CJS root, auth and api subpaths share auth identity and facade methods', () => {
  expect(SubpathAuth).toBe(YazioAuth);
  expect(typeof new Yazio(new SubpathAuth({ token })).user.getMealImages).toBe(
    'function',
  );
  const require = createRequire(import.meta.url);
  const root = require('@dimensi/yazio');
  const auth = require('@dimensi/yazio/auth');
  const api = require('@dimensi/yazio/api');
  expect(root.YazioAuth).toBe(auth.YazioAuth);
  const client = new root.Yazio(new auth.YazioAuth({ token }));
  for (const name of [
    'get',
    'getWeight',
    'getSuggestedProducts',
    'getDietaryPreferences',
    'getExercises',
    'getGoals',
    'getSettings',
    'getWaterIntake',
    'getDailySummary',
    'getConsumedItems',
    'getMealImages',
    'addConsumedItem',
    'removeConsumedItem',
    'getRecipe',
    'getRecipeIds',
    'deleteRecipe',
  ])
    expect(typeof client.user[name]).toBe('function');
  for (const name of [
    'getUserMealImages',
    'getTokenFromCredentials',
    'getTokenFromRefreshToken',
    'getUserConsumedItems',
    'getProduct',
    'getUserDailySummary',
  ])
    expect(typeof api[name]).toBe('function');
});
test('committed runtime artifacts match their provenance checksums', () => {
  const base = new URL('../../vendor/yazio/', import.meta.url);
  const hashes = JSON.parse(
    readFileSync(new URL('artifact-checksums.json', base), 'utf8'),
  ) as Record<string, string>;
  for (const [name, expected] of Object.entries(hashes)) {
    expect(
      createHash('sha256')
        .update(
          readFileSync(
            join(
              dirname(artifactRequire.resolve('@dimensi/yazio')),
              name.replace('dist/', ''),
            ),
          ),
        )
        .digest('hex'),
    ).toBe(expected);
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(name, base)))
        .digest('hex'),
    ).toBe(expected);
  }
});

test('source archive matches exact-commit provenance and contains no live-auth fixtures', () => {
  const base = new URL('../../vendor/yazio/', import.meta.url);
  const provenance = JSON.parse(
    readFileSync(new URL('provenance.json', base), 'utf8'),
  );
  expect(provenance.upstreamCommit).toBe(
    '89386f0db1ef15bc2bb21b359805d83c9fc7bbf7',
  );
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('upstream-source.tar.gz', base)))
      .digest('hex'),
  ).toBe(provenance.upstreamTree.archiveSha256);
  const sources = JSON.parse(
    readFileSync(new URL('source-checksums.json', base), 'utf8'),
  );
  expect(
    Object.keys(sources).every(
      (name) => name.startsWith('src/') || name === 'tests/meal-images.test.ts',
    ),
  ).toBe(true);
});
