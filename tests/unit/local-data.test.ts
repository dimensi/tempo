import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearLocalData,
  observeLocalDataReset,
  subscribeLocalDataReset,
} from '@/lib/local-data';
const mocks = vi.hoisted(() => ({
  purge: vi.fn(),
  video: vi.fn(),
  files: vi.fn(),
  reads: vi.fn(),
}));
vi.mock('@/lib/offline-device', () => ({
  OfflineStorage: class {
    purge = mocks.purge;
  },
}));
vi.mock('@/lib/workout-video-draft', () => ({ clearVideoDrafts: mocks.video }));
vi.mock('@/lib/client-read', () => ({ clientReads: { clear: mocks.reads } }));
vi.mock('@/lib/saved-files', () => ({ savedFiles: { clear: mocks.files } }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { setItem: vi.fn() });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('clears read and file memory together with both private storage databases', async () => {
  await clearLocalData();
  for (const action of Object.values(mocks))
    expect(action).toHaveBeenCalledOnce();
});
it.each(['purge', 'video'] as const)(
  'still attempts both database purges when %s fails',
  async (key) => {
    mocks[key].mockRejectedValue(new Error('Storage refused'));
    await expect(clearLocalData()).rejects.toThrow('Storage refused');
    for (const action of Object.values(mocks))
      expect(action).toHaveBeenCalledOnce();
  },
);
it('broadcasts explicit cleanup without broadcasting a session reset', async () => {
  await clearLocalData();
  expect(localStorage.setItem).toHaveBeenCalledWith(
    'tempo:local-data-reset',
    expect.any(String),
  );
  expect(localStorage.setItem).not.toHaveBeenCalledWith(
    'tempo:session-reset',
    expect.anything(),
  );
});
it('another tab resets read and file memory on the data notification without repurging read storage', async () => {
  const stop = observeLocalDataReset();
  const notified = vi.fn();
  const stopNotify = subscribeLocalDataReset(notified);
  const event = Object.assign(new Event('storage'), {
    key: 'tempo:local-data-reset',
  });
  window.dispatchEvent(event);
  expect(mocks.reads).toHaveBeenCalledOnce();
  expect(mocks.files).toHaveBeenCalledOnce();
  expect(mocks.video).toHaveBeenCalledOnce();
  expect(mocks.purge).not.toHaveBeenCalled();
  expect(notified).toHaveBeenCalledOnce();
  stop();
  stopNotify();
});
