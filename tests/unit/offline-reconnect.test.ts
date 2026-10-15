import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  activate: vi.fn(async () => {}),
  status: 'ready',
  role: 'OWNER',
  save: vi.fn(async () => {}),
  sync: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  refresh: vi.fn(),
}));
vi.mock('@/lib/offline-controller', () => ({
  getOfflineController: () => ({
    activate: mocks.activate,
    save: mocks.save,
    getSnapshot: () => ({
      status: mocks.status,
      bundle: { snapshot: { role: mocks.role } },
    }),
  }),
}));
vi.mock('@/lib/offline-write-client', () => ({ syncDeviceWrites: mocks.sync }));
vi.mock('@/lib/client-read', () => ({
  prepareMedicalReads: mocks.prepare,
  revalidateVisibleReads: mocks.refresh,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.status = 'ready';
  mocks.role = 'OWNER';
  mocks.activate.mockResolvedValue();
  mocks.sync.mockResolvedValue();
});
it('rechecks scope, synchronizes writes, then refreshes visible data without touching navigation', async () => {
  const { reconnectReads } = await import('@/lib/offline-reconnect');
  await reconnectReads();
  expect(mocks.activate).toHaveBeenCalledWith(true, true);
  expect(mocks.activate.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.sync.mock.invocationCallOrder[0]!,
  );
  expect(mocks.sync.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.refresh.mock.invocationCallOrder[0]!,
  );
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
it('does not publish or send queued writes when identity is unavailable or denied', async () => {
  const { reconnectReads } = await import('@/lib/offline-reconnect');
  for (const status of ['offline', 'error', 'disabled']) {
    mocks.status = status;
    await reconnectReads();
  }
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('coalesces simultaneous online/focus requests and retains independent reading after a write retry fails', async () => {
  const deferred = Promise.withResolvers<void>();
  mocks.activate.mockReturnValueOnce(deferred.promise);
  mocks.sync.mockRejectedValueOnce(new Error('retry later'));
  const { reconnectReads } = await import('@/lib/offline-reconnect');
  const a = reconnectReads(),
    b = reconnectReads();
  expect(a).toBe(b);
  deferred.resolve();
  await a;
  expect(mocks.activate).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('a trainer reconnect never attempts owner-only queue requests', async () => {
  mocks.role = 'TRAINER';
  const { reconnectReads } = await import('@/lib/offline-reconnect');
  await reconnectReads();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
