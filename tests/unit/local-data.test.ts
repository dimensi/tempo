import { afterEach, expect, it, vi } from 'vitest';
import { clearLocalData } from '@/lib/local-data';
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
afterEach(() => vi.resetAllMocks());
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
