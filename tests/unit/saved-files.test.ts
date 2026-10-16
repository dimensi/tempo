import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { savedFiles } from '@/lib/saved-files';
const mocks = vi.hoisted(() => ({
  files: vi.fn(),
  write: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.fetch }));
vi.mock('@/lib/session-state', () => ({
  readSession: () => ({ partition: 'owner' }),
  sessionGeneration: () => 1,
}));
vi.mock('@/lib/offline-device', () => ({
  OfflineStorage: class {
    files = mocks.files;
    writeFile = mocks.write;
  },
  offlineFileLimits: { singleBytes: 256 * 1024 * 1024 },
  subscribeSessionReset: () => () => {},
}));
beforeEach(() => {
  savedFiles.clear();
  vi.stubGlobal('location', { origin: 'https://app.test' });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('a file listing started before device cleanup cannot republish its saved blobs', async () => {
  let finish!: (value: unknown[]) => void;
  mocks.files.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = savedFiles.load();
  savedFiles.clear();
  finish([{ id: 'old', bytes: new Blob(['private']) }]);
  await pending;
  expect(savedFiles.getSnapshot()).toEqual({ files: [], ready: true });
});
it('a file download started before device cleanup cannot persist its late bytes', async () => {
  let finish!: (value: Blob) => void;
  const blob = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  mocks.fetch.mockResolvedValue({ ok: true, blob: () => blob });
  const pending = savedFiles.saveFile({
    id: 'old',
    label: 'Report',
    kind: 'pdf',
    href: '/api/reports',
  });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  savedFiles.clear();
  const rejected = expect(pending).rejects.toThrow('Local data changed');
  finish(new Blob(['private'], { type: 'application/pdf' }));
  await rejected;
  expect(mocks.write).not.toHaveBeenCalled();
});
