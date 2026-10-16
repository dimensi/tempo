import { afterEach, expect, it, vi } from 'vitest';
const conceal = vi.hoisted(() => vi.fn());
vi.mock('@/lib/offline-device', () => ({ notifyOfflineBlocked: conceal }));
import {
  beginLocalLogout,
  hasPendingLogout,
  finishPendingLogout,
} from '@/lib/local-logout';
afterEach(() => {
  vi.unstubAllGlobals();
  conceal.mockClear();
});
it('conceals synchronously and keeps durable intent while server logout cannot complete', async () => {
  const rows = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => rows.get(key),
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  });
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('fetch', vi.fn());
  beginLocalLogout();
  expect(conceal).toHaveBeenCalledOnce();
  expect(hasPendingLogout()).toBe(true);
  expect(await finishPendingLogout()).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(hasPendingLogout()).toBe(true);
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
  expect(await finishPendingLogout()).toBe(false);
  expect(hasPendingLogout()).toBe(true);
  vi.mocked(fetch).mockResolvedValue(new Response('{}'));
  expect(await finishPendingLogout()).toBe(true);
  expect(hasPendingLogout()).toBe(false);
});
it('still conceals if durable storage fails', () => {
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw Error('closed');
    },
  });
  expect(() => beginLocalLogout()).toThrow();
  expect(conceal).toHaveBeenCalledOnce();
});
