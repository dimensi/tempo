import { afterEach, expect, it, vi } from 'vitest';
import { subscribeOfflineBlocked } from '@/lib/offline-device';
afterEach(() => vi.unstubAllGlobals());
it('late worker purge cannot conceal a newer verified scope, but current and unscoped denials do', () => {
  const browser = new EventTarget();
  const worker = new EventTarget();
  let gate = JSON.stringify({ epoch: 'new-scope', disabled: false });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('navigator', { serviceWorker: worker });
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('localStorage', {
    getItem: () => gate,
    setItem: (_key: string, value: string) => {
      gate = value;
    },
  });
  const blocked = vi.fn();
  const stop = subscribeOfflineBlocked(blocked);
  const message = (previousEpoch?: string) =>
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'OFFLINE_BLOCKED', previousEpoch },
      }),
    );
  message('old-scope');
  expect(blocked).not.toHaveBeenCalled();
  message('new-scope');
  expect(blocked).toHaveBeenCalledOnce();
  gate = JSON.stringify({ epoch: 'third-scope', disabled: false });
  message();
  expect(blocked).toHaveBeenCalledTimes(2);
  stop();
});

it('synchronous conceal includes real portal roots outside the private workspace', async () => {
  const workspace = { hidden: false };
  const portal = { hidden: false };
  const query = vi.fn((selector: string) =>
    selector.includes('[data-portal]') ? [workspace, portal] : [workspace],
  );
  vi.stubGlobal('document', { querySelectorAll: query });
  const { concealOfflineContent } = await import('@/lib/offline-device');
  concealOfflineContent();
  expect(workspace.hidden).toBe(true);
  expect(portal.hidden).toBe(true);
});
