import { expect, it, vi } from 'vitest';
import { recoverOnlineRoute } from '@/lib/offline-recovery';
import type { OfflineController } from '@/lib/offline-controller';
function reader(status = 'ready') {
  return {
    activate: vi.fn(async () => {}),
    getSnapshot: () => ({ status }),
  } as unknown as OfflineController;
}
it('keeps saved UI when identity works but the document is unavailable', async () => {
  const controller = reader();
  const request = vi.fn(async () => new Response('down', { status: 503 }));
  expect(
    await recoverOnlineRoute(
      'https://tempo.test/analytics',
      controller,
      request,
    ),
  ).toBe(false);
  expect(controller.activate).toHaveBeenLastCalledWith(false, true);
});
it('requires HTML even when the cache cannot be prepared and permits the normal login redirect', async () => {
  const controller = reader('offline');
  const request = vi.fn(
    async () =>
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
  expect(
    await recoverOnlineRoute('https://tempo.test/', controller, request),
  ).toBe(false);
  expect(request).toHaveBeenCalledOnce();
  expect(
    await recoverOnlineRoute('https://tempo.test/', reader(), request),
  ).toBe(false);
  const redirected = new Response('', {
    headers: { 'content-type': 'text/html' },
  });
  Object.defineProperties(redirected, {
    redirected: { value: true },
    url: { value: 'https://tempo.test/login' },
  });
  expect(
    await recoverOnlineRoute(
      'https://tempo.test/',
      reader(),
      async () => redirected,
    ),
  ).toBe(true);
});
it('normalizes a cold shell bookmark and accepts an available actual document', async () => {
  const request = vi.fn(async (url: RequestInfo | URL) => {
    expect(url).toBe('https://tempo.test/');
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    });
  });
  expect(
    await recoverOnlineRoute(
      'https://tempo.test/offline/index.html',
      reader(),
      request,
    ),
  ).toBe(true);
  expect(request.mock.calls[0]?.[0]).toBe('https://tempo.test/');
});
