import type { MedicalDocument } from '@/contracts/anamnesis';
import { DocumentViewer } from '@/features/anamnesis/document-viewer';
import { DocumentsPanel } from '@/features/anamnesis/documents-panel';
import { Button, FileInput } from '@mantine/core';
import { isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  online: false,
  readError: undefined as string | undefined,
}));
const document: MedicalDocument = {
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
};
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [
    initial === null ? { name: 'selected.pdf' } : initial,
    vi.fn(),
  ],
  useEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('@/lib/use-read-online', () => ({ useReadOnline: () => state.online }));
vi.mock('@/lib/use-read-resource', () => ({
  useReadResource: (resource: { href: string }) => ({
    data: resource.href.includes('/observations?')
      ? [
          {
            observation: {
              originalName: 'Synthetic marker',
              collectedAt: '2026-01-01',
            },
            sources: [
              {
                id: 'quote',
                documentId: 'doc',
                pageNumber: 1,
                rawText: 'Cached citation',
              },
            ],
          },
        ]
      : resource.href.includes('/documents/doc?')
        ? document
        : [],
    error: state.readError,
  }),
}));
vi.mock('@/lib/client-read', () => ({
  invalidateMedicalDocument: vi.fn(),
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
  state.readError = undefined;
  vi.unstubAllGlobals();
});
it.each([undefined, 'unavailable'])(
  'renders the cached document and its citations during refresh error=%s',
  (error) => {
    state.readError = error;
    vi.stubGlobal('fetch', vi.fn());
    const tree = nodes(
      DocumentViewer({ ownerId: 'owner', documentId: 'doc', writable: true }),
    );
    expect(tree.some((node) => node.type === 'object')).toBe(state.online);
    expect(tree.some((node) => node.props.children === 'saved.pdf')).toBe(true);
    expect(
      tree.some(
        (node) =>
          Array.isArray(node.props.children) &&
          node.props.children.includes('Cached citation'),
      ),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  'exposes direct document download only online=%s',
  (online) => {
    state.online = online;
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
