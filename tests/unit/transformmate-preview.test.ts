import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  database: null as ReturnType<
    typeof import('@/server/db/connection').openDatabase
  > | null,
  getExercise: vi.fn(),
  authorize: vi.fn(),
  assertCurrent: vi.fn(),
}));
vi.mock('@/server/db', () => ({ getDatabase: () => mocks.database }));
vi.mock('@/server/auth/guards', () => ({ authorize: mocks.authorize }));
vi.mock('@/server/transformmate/runtime', () => ({
  getTransformMateConnectionFence: async () => ({
    accountScope: 'account',
    generation: 'preview',
    client: mocks,
    assertCurrent: mocks.assertCurrent,
    assertBindingCurrent() {},
  }),
}));
import { openDatabase } from '@/server/db/connection';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { user } from '@/server/db/schema';
import { catalogStore } from '@/server/transformmate/catalog-store';
import {
  streamExercisePreview,
  selectPreviewUrl,
} from '@/server/transformmate/preview';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';
const scope = {
  ownerId: 'owner',
  accountScope: 'account',
  generation: 'preview',
  locale: 'ru' as const,
};
const url =
  'https://transformmate.pht.space/media/real.jpg?signature=synthetic';
const request = () =>
  new Request('https://app.test/preview?ownerId=owner', {
    headers: { Authorization: 'private-jwt', Cookie: 'session=private' },
  });
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.database = openDatabase('file::memory:');
  migrate(mocks.database.db, { migrationsFolder: './drizzle' });
  mocks.database.db
    .insert(user)
    .values({
      id: 'owner',
      name: 'Synthetic',
      role: 'OWNER',
      email: 'owner@example.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.assertCurrent.mockResolvedValue(undefined);
  mocks.getExercise.mockResolvedValue({
    body: { ...exerciseDetailFixture(), image: url },
  });
});
afterEach(() => {
  mocks.database?.sqlite.close();
  vi.useRealTimers();
});
it.each([
  'http://transformmate.pht.space/a',
  'https://transformmate.pht.space.evil.test/a',
  'https://user@transformmate.pht.space/a',
  'https://transformmate.pht.space:443/a',
  'https://transformmate.pht.space/a#x',
  'https://127.0.0.1/a',
])('rejects unapproved preview source %s', (value) =>
  expect(selectPreviewUrl(value)).toBeNull(),
);
it('verifies image bytes, forwards no credentials and persists validated availability', async () => {
  const fetchImage = vi.fn().mockResolvedValue(
    new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Set-Cookie': 'secret',
        Location: url,
      },
    }),
  );
  const response = await streamExercisePreview(request(), '501', fetchImage);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  expect(fetchImage.mock.calls[0]![1]).toMatchObject({
    headers: {},
    redirect: 'error',
    cache: 'no-store',
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.has('location')).toBe(false);
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'available',
  );
});
it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])(
  'rejects unsafe MIME %s and retains unknown coverage',
  async (type) => {
    const response = await streamExercisePreview(
      request(),
      '501',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<svg/>', { headers: { 'Content-Type': type } }),
        ),
    );
    expect(response.status).toBe(502);
    expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
      'unknown',
    );
  },
);
it('rejects declared oversized and chunked oversized payloads, cancelling the stream', async () => {
  vi.useFakeTimers();
  for (const declared of [true, false]) {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel,
    });
    const response = await streamExercisePreview(
      request(),
      '501',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: {
            'Content-Type': 'image/png',
            ...(declared
              ? { 'Content-Length': String(5 * 1024 * 1024 + 1) }
              : {}),
          },
        }),
      ),
    );
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
  }
});
it('rejects HTML masquerading as an approved image MIME', async () => {
  expect(
    (
      await streamExercisePreview(
        request(),
        '501',
        vi.fn().mockResolvedValue(
          new Response('<html/>', {
            headers: { 'Content-Type': 'image/png' },
          }),
        ),
      )
    ).status,
  ).toBe(502);
});
it('denied/revoked grants prevent media delivery and cache availability writes', async () => {
  mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
  const fetchImage = vi.fn();
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(403);
  expect(fetchImage).not.toHaveBeenCalled();
  mocks.authorize.mockResolvedValue({ ok: true });
  fetchImage.mockImplementation(async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(403);
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'unknown',
  );
});
it('does not retry an unchanged broken image URL and suppresses requests for 60 seconds', async () => {
  vi.useFakeTimers();
  const fetchImage = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 403 }));
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(502);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(mocks.getExercise).toHaveBeenCalledTimes(2);
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(502);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(mocks.getExercise).toHaveBeenCalledTimes(2);
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'unknown',
  );
  vi.advanceTimersByTime(60_000);
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(502);
  expect(fetchImage).toHaveBeenCalledTimes(2);
  expect(mocks.getExercise).toHaveBeenCalledTimes(3);
});

it('client abort reaches the private fetch and does not persist availability', async () => {
  const abort = new AbortController();
  let received: AbortSignal | undefined;
  const fetchImage = vi.fn().mockImplementation(async (_url, init) => {
    received = init.signal;
    abort.abort();
    throw new Error('aborted');
  });
  const response = await streamExercisePreview(
    new Request('https://app.test/preview?ownerId=owner', {
      signal: abort.signal,
    }),
    '501',
    fetchImage,
  );
  expect(response.status).toBe(502);
  expect(received?.aborted).toBe(true);
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'unknown',
  );
});

it('retries a changed image URL after forced metadata refresh with the same abort deadline', async () => {
  const changed = 'https://transformmate.pht.space/media/changed.png';
  mocks.getExercise
    .mockResolvedValueOnce({ body: { ...exerciseDetailFixture(), image: url } })
    .mockResolvedValueOnce({
      body: { ...exerciseDetailFixture(), image: changed },
    });
  const fetchImage = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(
      new Response(png, { headers: { 'Content-Type': 'image/png' } }),
    );
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(200);
  expect(fetchImage).toHaveBeenCalledTimes(2);
  expect(fetchImage.mock.calls[1]![0].href).toBe(changed);
  expect(fetchImage.mock.calls[0]![1].signal).toBe(
    fetchImage.mock.calls[1]![1].signal,
  );
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'available',
  );
});
it('checks revoked authorization before returning a cached negative preview', async () => {
  const fetchImage = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 404 }));
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(502);
  const original = catalogStore().record(scope, 501);
  mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(403);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(catalogStore().record(scope, 501)).toEqual(original);
});
it('revocation after forced metadata refresh prevents changed image delivery and preview writes', async () => {
  const changed = 'https://transformmate.pht.space/media/changed.png';
  mocks.getExercise
    .mockResolvedValueOnce({ body: { ...exerciseDetailFixture(), image: url } })
    .mockImplementationOnce(async () => {
      mocks.authorize.mockResolvedValue({ ok: false, status: 403 });
      return { body: { ...exerciseDetailFixture(), image: changed } };
    });
  const fetchImage = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 403 }));
  expect(
    (await streamExercisePreview(request(), '501', fetchImage)).status,
  ).toBe(403);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(catalogStore().record(scope, 501)?.detail?.image).toBe(url);
  expect(catalogStore().record(scope, 501)?.detail?.previewCoverage).toBe(
    'unknown',
  );
});
