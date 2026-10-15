import { expect, it } from 'vitest';
import {
  syncResultKind,
  syncStatusSchema,
  type SyncStatus,
} from '@/contracts/nutrition-sync';
const complete: SyncStatus = {
  state: 'completed',
  startedAt: null,
  finishedAt: null,
  completedDates: ['2026-10-12'],
  skippedDates: [],
  failedDates: [],
  photoFailedDates: [],
};
it('separates genuine food completion, photo warnings and food failures', () => {
  expect(syncResultKind(complete)).toBe('loaded');
  expect(
    syncResultKind({
      ...complete,
      state: 'partial',
      photoFailedDates: ['2026-10-12'],
    }),
  ).toBe('photos-pending');
  expect(
    syncResultKind({
      ...complete,
      state: 'completed',
      photoFailedDates: ['2026-10-12'],
    }),
  ).toBe('photos-pending');
  expect(
    syncResultKind({
      ...complete,
      state: 'partial',
      failedDates: ['2026-10-11'],
      photoFailedDates: ['2026-10-12'],
    }),
  ).toBe('incomplete');
  expect(syncResultKind({ ...complete, state: 'running' })).toBe('incomplete');
  expect(
    syncResultKind({
      ...complete,
      state: 'partial',
      completedDates: [],
      skippedDates: [],
      photoFailedDates: ['2026-10-12'],
    }),
  ).toBe('incomplete');
});
it('requires the new photo field without a compatibility default', () => {
  const obsolete: Partial<SyncStatus> = { ...complete };
  delete obsolete.photoFailedDates;
  expect(syncStatusSchema.safeParse(obsolete).success).toBe(false);
});
it('accepts already loaded history as successful and distinguishes pending photo repair', () => {
  const skipped: SyncStatus = {
    ...complete,
    completedDates: [],
    skippedDates: ['2026-10-01'],
  };
  expect(syncResultKind(skipped)).toBe('loaded');
  expect(
    syncResultKind({
      ...skipped,
      state: 'partial',
      photoFailedDates: ['2026-10-01'],
    }),
  ).toBe('photos-pending');
  const obsolete: Partial<SyncStatus> = { ...complete };
  delete obsolete.skippedDates;
  expect(syncStatusSchema.safeParse(obsolete).success).toBe(false);
});
