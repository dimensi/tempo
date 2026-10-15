import { afterEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Button, FileInput } from '@mantine/core';
import type { MedicalDocument } from '@/contracts/anamnesis';
const state = vi.hoisted(() => ({
  online: false,
  index: 0,
  viewer: false,
  runEffects: false,
  savedDocumentCalls: 0,
  savedDocumentPromise: undefined as Promise<MedicalDocument> | undefined,
  documentUpdates: [] as unknown[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    return [
      state.viewer && index === 0
        ? { id: 'doc', filename: 'report.pdf', pageCount: 1 }
        : !state.viewer && index === 8
          ? { name: 'selected.pdf' }
          : initial,
      index === 0 && state.viewer
        ? (value: unknown) => state.documentUpdates.push(value)
        : vi.fn(),
    ];
  },
  useEffect: (effect: () => void) => {
    if (state.runEffects) effect();
  },
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/use-read-online', () => ({ useReadOnline: () => state.online }));
vi.mock('@/lib/use-read-refresh', () => ({ useReadRefresh: () => 0 }));
vi.mock('@/lib/use-read-resource', () => ({ useReadResource: vi.fn() }));
vi.mock('@/lib/client-read', () => ({
  invalidateMedicalDocument: vi.fn(),
  savedMedicalDocument: async () => {
    state.savedDocumentCalls++;
    return (
      state.savedDocumentPromise ??
      Promise.resolve({
        id: 'doc',
        ownerId: 'owner',
        filename: 'saved.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        pageCount: 1,
        laboratoryName: null,
        title: null,
        collectedAt: null,
        issuedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
    );
  },
}));
vi.mock('@/features/anamnesis/refresh', () => ({
  useAnamnesisRevision: () => 0,
  notifyAnamnesisChanged: vi.fn(),
}));
vi.mock('@/features/anamnesis/review-editor', () => ({
  ReviewEditor: () => null,
}));
vi.mock('@/components/shared/offline-file', () => ({
  OfflineFile: () => null,
}));
import { DocumentViewer } from '@/features/anamnesis/document-viewer';
import { DocumentsPanel } from '@/features/anamnesis/documents-panel';
function nodes(
  node: ReactNode,
): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node))
    return [];
  return [
    { type: node.type, props: node.props },
    ...nodes(node.props.children),
  ];
}
afterEach(() => {
  state.index = 0;
  state.runEffects = false;
  state.savedDocumentCalls = 0;
  state.savedDocumentPromise = undefined;
  state.documentUpdates = [];
  vi.unstubAllGlobals();
});
it('does not let a late saved document overwrite a fresher live response', async () => {
  const saved = Promise.withResolvers<MedicalDocument>();
  state.savedDocumentPromise = saved.promise;
  state.viewer = true;
  state.runEffects = true;
  const live: MedicalDocument = {
    id: 'doc',
    ownerId: 'owner',
    filename: 'live.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    pageCount: 1,
    laboratoryName: null,
    title: null,
    collectedAt: null,
    issuedAt: null,
    createdAt: 1,
    updatedAt: 2,
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(live))
      .mockResolvedValueOnce(Response.json([])),
  );
  DocumentViewer({
    ownerId: 'owner',
    documentId: 'doc',
    writable: true,
    preferSaved: true,
  });
  await vi.waitFor(() => expect(state.documentUpdates).toContainEqual(live));
  saved.resolve({ ...live, filename: 'stale.pdf', updatedAt: 1 });
  await Promise.resolve();
  expect(state.documentUpdates.at(-1)).toEqual(live);
});

it('loads a saved document before a stalled live refresh on an offline projection', async () => {
  state.viewer = true;
  state.runEffects = true;
  DocumentViewer({
    ownerId: 'owner',
    documentId: 'doc',
    writable: true,
    preferSaved: true,
  });
  await vi.waitFor(() => expect(state.savedDocumentCalls).toBe(1));
});
it.each([false, true])(
  'exposes direct document download only online=%s',
  (online) => {
    state.online = online;
    state.viewer = true;
    const tree = DocumentViewer({
      ownerId: 'owner',
      documentId: 'doc',
      writable: true,
    });
    expect(
      nodes(tree).some(
        (node) =>
          node.type === 'a' && String(node.props.href).includes('/doc/file'),
      ),
    ).toBe(online);
  },
);
it.each([false, true])(
  'disables picking and uploading a selected PDF while online=%s',
  (online) => {
    state.online = online;
    state.viewer = false;
    const rendered = nodes(
      DocumentsPanel({ ownerId: 'owner', writable: true }),
    );
    expect(
      rendered.find((node) => node.type === FileInput)?.props.disabled,
    ).toBe(!online);
    expect(
      rendered.find(
        (node) => node.type === Button && node.props.loading === false,
      )?.props.disabled,
    ).toBe(!online);
  },
);
