import { afterEach, expect, it, vi } from 'vitest';
import { attachOfflineRefresh } from '@/features/offline/refresh';
import { concealOfflineContent } from '@/lib/offline-device';

vi.mock('@/lib/offline-device', () => ({
  concealOfflineContent: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('rechecks access without suspending the mounted screen on connectivity changes', async () => {
  vi.useFakeTimers();
  const activate = vi.fn(async () => {});
  const suspend = vi.fn();
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
  });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('navigator', { onLine: true });

  const detach = attachOfflineRefresh({
    activate,
    suspend,
    save: vi.fn(async () => {}),
    getSnapshot: () => ({ status: 'ready' }),
  } as never);
  await vi.advanceTimersByTimeAsync(200);
  expect(activate).toHaveBeenLastCalledWith(true, true);

  windowTarget.dispatchEvent(new Event('offline'));
  expect(activate).toHaveBeenLastCalledWith(false, true);
  expect(suspend).not.toHaveBeenCalled();
  expect(concealOfflineContent).not.toHaveBeenCalled();

  windowTarget.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(200);
  expect(activate).toHaveBeenLastCalledWith(true, true);
  expect(suspend).not.toHaveBeenCalled();

  windowTarget.dispatchEvent(new Event('pagehide'));
  expect(suspend).toHaveBeenCalledOnce();
  expect(concealOfflineContent).toHaveBeenCalledOnce();
  detach();
});
