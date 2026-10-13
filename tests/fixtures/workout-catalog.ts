import type { TransformMateCatalogItem } from '@/contracts/transformmate';
export const richCatalogFields = {
  publicationCapability: { state: 'supported', reason: null },
  snippet: null,
  preview: { coverage: 'absent', path: null, revision: 'a'.repeat(64) },
  detailCoverage: 'available',
  membershipCoverage: 'available',
  muscleGroups: [],
  fetchedAt: '2026-10-12T00:00:00Z',
  detailFetchedAt: '2026-10-12T00:00:00Z',
} satisfies Omit<TransformMateCatalogItem, 'id' | 'name' | 'canPlan'>;
