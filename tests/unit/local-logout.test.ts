import {
  beginLocalLogout,
  finishPendingLogout,
  hasPendingLogout,
} from '@/lib/local-logout';
import { afterEach, expect, it, vi } from 'vitest';
const reset = vi.hoisted(() => vi.fn());
vi.mock('@/lib/session-state', () => ({ resetSession: reset }));
afterEach(() => {
  vi.unstubAllGlobals();
  reset.mockClear();
});
it('keeps durable logout intent until server sign-out succeeds', async () => {
  const rows = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => rows.get(key),
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  });
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('fetch', vi.fn());
  beginLocalLogout();
  expect(reset).toHaveBeenCalledOnce();
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
it('resets the in-memory session even when durable storage refuses a marker', () => {
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw Error('closed');
    },
  });
  expect(() => beginLocalLogout()).not.toThrow();
  expect(reset).toHaveBeenCalledOnce();
});
