import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  generation: 'generation',
  calls: 0,
  changeAt: Infinity,
  denied: false,
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
    listAnamnesisDocuments: async () => [],
    listAnamnesisReports: async () => [],
  };
});
import { offlineAnamnesis } from '@/server/offline/anamnesis';
beforeEach(() => {
  state.calls = 0;
  state.changeAt = Infinity;
  state.denied = false;
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
