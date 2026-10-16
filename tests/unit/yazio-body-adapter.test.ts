import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/server/yazio/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/yazio/client')>()),
  createYazioAuth: async (store: { load: () => Promise<unknown> }) => {
    await store.load();
    return {
      authenticate: async () => ({ access_token: 'synthetic-body-token' }),
    };
  },
}));
import { bodyUpstream } from '@/server/yazio/body-adapter';
const uuid = '90000000-0000-4000-8000-000000000001';
afterEach(() => {
  vi.unstubAllGlobals();
});
it('sends the APK POST/PUT wire with stable UUID, wall-time, authorization, UA and bounded native transport', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const assertCurrent = vi.fn(async () => {}),
    source = await bodyUpstream({
      load: async () => null,
      save: async () => {},
      assertCurrent,
    });
  await source.create('biceps', {
    id: uuid,
    date: '2026-10-13 00:00:00',
    value: 35.125,
  });
  await source.update(uuid, '35.5');
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://yzapi.yazio.com/v20/user/bodyvalues',
  );
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
    'circumference.arm': [
      { id: uuid, date: '2026-10-13 00:00:00', value: 35.125 },
    ],
  });
  expect(fetcher.mock.calls[1]![1]!.method).toBe('PUT');
  expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({
    value: 35.5,
  });
  const options = fetcher.mock.calls[0]![1]!;
  expect(new Headers(options.headers).get('User-Agent')).toContain('YAZIO/');
  expect(new Headers(options.headers).get('Authorization')).toBe(
    'Bearer synthetic-body-token',
  );
  expect(options).toMatchObject({ cache: 'no-store', redirect: 'error' });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(assertCurrent).toHaveBeenCalledTimes(8);
});
it('fences a connection change after response headers but before its body finishes', async () => {
  let release!: (value: Uint8Array) => void,
    revoked = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              release = (value) => {
                controller.enqueue(value);
                controller.close();
              };
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
  const source = await bodyUpstream({
    load: async () => null,
    save: async () => {},
    assertCurrent: async () => {
      if (revoked) throw new Error('Synthetic revoked');
    },
  });
  const pending = source.summary('2026-10-13');
  await vi.waitFor(() => expect(release).toBeDefined());
  revoked = true;
  release(new TextEncoder().encode('{}'));
  await expect(pending).rejects.toThrow('Synthetic revoked');
});
it('rejects malformed summaries and errors instead of treating them as UUID absence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'not a body summary' })),
  );
  const source = await bodyUpstream({
    load: async () => null,
    save: async () => {},
  });
  await expect(source.summary('2026-10-13')).rejects.toThrow();
});
