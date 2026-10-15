import type { MedicalDocument } from '@/contracts/anamnesis';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  generation: 'generation',
  calls: 0,
  changeAt: Infinity,
  denied: false,
  documents: [] as MedicalDocument[],
}));
vi.mock('@/server/offline/index', () => ({
  offlineIdentity: async () => {
    state.calls++;
    return {
      partition: 'partition',
      connectionGeneration:
        state.calls >= state.changeAt ? 'revoked' : state.generation,
    };
  },
}));
vi.mock('@/server/access/owner', () => ({
  getAccessibleOwnerId: async () => 'owner',
}));
vi.mock('@/server/anamnesis', () => {
  class AnamnesisError extends Error {
    constructor(public status: number) {
      super('denied');
    }
  }
  return {
    AnamnesisError,
    getAnamnesisOverview: async () => {
      if (state.denied) throw new AnamnesisError(403);
      return {
        documents: 0,
        markers: 0,
        observations: 0,
        pendingReviews: 0,
        activeImports: 0,
        pendingDocumentId: null,
        activeDocumentId: null,
        lastCollectedAt: null,
      };
    },
    listAnamnesisMarkers: async () => [],
    listAnamnesisDocuments: async () => state.documents,
    listAnamnesisReports: async () => [],
  };
});
import { offlineAnamnesis } from '@/server/offline/anamnesis';
beforeEach(() => {
  state.calls = 0;
  state.changeAt = Infinity;
  state.denied = false;
  state.documents = [];
});
it('returns bounded authorized structured summaries without file downloads or OCR', async () => {
  expect(await offlineAnamnesis(new Headers())).toEqual({
    partition: 'partition',
    connectionGeneration: 'generation',
    data: {
      version: 1,
      ownerId: 'owner',
      overview: {
        documents: 0,
        markers: 0,
        observations: 0,
        pendingReviews: 0,
        activeImports: 0,
        pendingDocumentId: null,
        activeDocumentId: null,
        lastCollectedAt: null,
      },
      markers: [],
      documents: [],
      reports: [],
      complete: true,
    },
  });
  expect(state.calls).toBe(2);
});
it('cannot release a medical projection if grants changed while reading it', async () => {
  state.changeAt = 2;
  await expect(offlineAnamnesis(new Headers())).rejects.toMatchObject({
    status: 409,
  });
});
it('an absent medical permission does not disable unrelated saved sections', async () => {
  state.denied = true;
  expect(await offlineAnamnesis(new Headers())).toBeNull();
});

it.each(['2026-10', '2026-10-15', '2026-10-15T09:30:00'])(
  'preserves document date precision %s produced by the import pipeline',
  async (collectedAt) => {
    state.documents = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        ownerId: '10000000-0000-4000-8000-000000000002',
        filename: 'synthetic.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        pageCount: 1,
        laboratoryName: null,
        title: null,
        collectedAt,
        issuedAt: '2026-10',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const result = await offlineAnamnesis(new Headers());
    expect(result?.data.documents[0]?.collectedAt).toBe(collectedAt);
    expect(result?.data.documents[0]?.issuedAt).toBe('2026-10');
  },
);
