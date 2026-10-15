import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  status: 'checking',
  role: 'OWNER',
  listeners: new Set<() => void>(),
  effect: () => () => {},
  sync: vi.fn(async () => {}),
}));
vi.mock('react', () => ({
  useEffect: (effect: typeof state.effect) => {
    state.effect = effect;
  },
}));
vi.mock('@/lib/client-read', () => ({
  observeReadResources: () => () => {},
  prepareMedicalReads: async () => {},
  revalidateVisibleReads: vi.fn(),
}));
vi.mock('@/lib/offline-device', () => ({
  observeOfflineDenials: () => () => {},
  purgeOfflineDevice: async () => {},
}));
vi.mock('@/features/offline/refresh', () => ({
  attachOfflineRefresh: () => () => {},
}));
vi.mock('@/lib/offline-controller', () => ({
  getOfflineController: () => ({
    listen: () => () => {},
    activate: async () => {},
    getSnapshot: () => ({
      status: state.status,
      bundle: {
        fence: { partition: 'owner', deviceEpoch: 'epoch' },
        snapshot: { role: state.role },
      },
    }),
    subscribe: (listener: () => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  }),
}));
vi.mock('@/lib/offline-write-client', () => ({
  syncDeviceWrites: state.sync,
  hasPendingDeviceWrites: async () => false,
}));
import { OfflineLifecycle } from '@/features/offline/lifecycle';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  state.listeners.clear();
});
it.each(['OWNER', 'TRAINER'])(
  'initializes an eventual ready scope after a superseded activation, only for snapshot role %s',
  async (role) => {
    vi.useFakeTimers();
    state.status = 'checking';
    state.role = role;
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    );
    vi.stubGlobal('navigator', { onLine: true });
    OfflineLifecycle({ role: 'OWNER' });
    const cleanup = state.effect();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.sync).not.toHaveBeenCalled();
    state.status = 'ready';
    for (const listener of state.listeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.sync).toHaveBeenCalledTimes(role === 'OWNER' ? 1 : 0);
    for (const listener of state.listeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.sync).toHaveBeenCalledTimes(role === 'OWNER' ? 1 : 0);
    cleanup();
  },
);
