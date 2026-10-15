import { afterEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
const state = vi.hoisted(() => ({
  online: false,
  index: 0,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    return [
      index === 0
        ? [
            {
              id: 'report',
              markerIds: ['marker'],
              createdAt: '2026-10-15T00:00:00Z',
            },
          ]
        : index === 1
          ? [{ marker: { id: 'marker', name: 'Marker' }, observationCount: 1 }]
          : initial,
      vi.fn(),
    ];
  },
  useEffect: (effect: () => void | (() => void)) => {
    state.effects.push(effect);
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/use-read-online', () => ({ useReadOnline: () => state.online }));
vi.mock('@/lib/use-read-refresh', () => ({ useReadRefresh: () => 0 }));
vi.mock('@/features/anamnesis/refresh', () => ({
  useAnamnesisRevision: () => 0,
}));
vi.mock('@/components/shared/offline-file', () => ({
  OfflineFile: () => null,
}));
vi.mock('@/features/anamnesis/api', () => ({
  ownerIdQuery: () => 'ownerId=owner',
  fetchAnamnesis: vi.fn(async () => []),
  AnamnesisFetchError: class extends Error {},
}));
import { fetchAnamnesis } from '@/features/anamnesis/api';
import { ReportsPanel } from '@/features/anamnesis/reports-panel';
function hrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (
    !isValidElement<{
      href?: string;
      children?: ReactNode;
      component?: string;
    }>(node)
  )
    return [];
  return [
    ...(node.props.href && node.props.component === 'a'
      ? [node.props.href]
      : []),
    ...hrefs(node.props.children),
  ];
}
afterEach(() => {
  vi.clearAllMocks();
  state.index = 0;
  state.effects = [];
});
it.each([false, true])(
  'only exposes network report downloads and date requests when online=%s',
  async (online) => {
    state.online = online;
    const tree = ReportsPanel({ ownerId: 'owner' });
    expect(
      hrefs(tree).some((href) => href.includes('/reports/report/file')),
    ).toBe(online);
    const cleanups = state.effects.map((effect) => effect());
    expect(
      vi
        .mocked(fetchAnamnesis)
        .mock.calls.some(([url]) => url.includes('/reports/dates')),
    ).toBe(online);
    cleanups.forEach((cleanup) => cleanup?.());
    await Promise.resolve();
  },
);
