import { afterEach, expect, it, vi } from 'vitest';
import { interceptOfflineLinks } from '@/features/offline/routing';
import { reportNetworkResult } from '@/lib/network-state';

afterEach(() => {
  vi.unstubAllGlobals();
  reportNetworkResult(true);
});
it.each(['/workouts/one/edit', '/workouts/one/results', '/workouts/new'])(
  'keeps %s local until both interface and server are reachable',
  (path) => {
    let click!: (event: MouseEvent) => void;
    const pushState = vi.fn();
    vi.stubGlobal('document', {
      addEventListener: (_: string, fn: typeof click) => {
        click = fn;
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('window', { scrollTo: vi.fn(), dispatchEvent: vi.fn() });
    vi.stubGlobal('location', new URL('https://tempo.test/workouts'));
    vi.stubGlobal('history', { pushState });
    vi.stubGlobal('navigator', { onLine: true });
    const cleanup = interceptOfflineLinks();
    const preventDefault = vi.fn();
    const event = {
      button: 0,
      target: { closest: () => ({ href: `https://tempo.test${path}` }) },
      preventDefault,
    } as unknown as MouseEvent;
    reportNetworkResult(false);
    click(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(null, '', path);
    reportNetworkResult(true);
    click(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    cleanup();
  },
);
