import { expect, it } from 'vitest';
import { savedMealPhotoId } from '@/lib/saved-meal-photo';
import type { OfflineSnapshot } from '@/contracts/offline';
const live = {
  id: 'live-id',
  date: '2026-10-15',
  daytime: 'breakfast' as const,
  source: 'manual' as const,
  observedAt: '2026-10-15T08:00:00.000Z',
};
const saved: OfflineSnapshot['photos']['items'][number] = {
  ...live,
  id: 'A'.repeat(43),
  mime: 'image/png',
  downloadUrl: `/api/offline/photos/${'A'.repeat(43)}?date=2026-10-15`,
};
it('matches safe photo metadata without treating a remote URL as local bytes', () => {
  expect(savedMealPhotoId(live, [saved])).toBe(saved.id);
  expect(
    savedMealPhotoId({ ...live, date: '2026-10-14' }, [saved]),
  ).toBeUndefined();
  expect(
    savedMealPhotoId({ ...live, source: 'yazio' }, [saved]),
  ).toBeUndefined();
  expect(
    savedMealPhotoId({ ...live, observedAt: '2026-10-15T09:00:00.000Z' }, [
      saved,
    ]),
  ).toBeUndefined();
  expect(savedMealPhotoId(live, [])).toBeUndefined();
});
it('never substitutes another manual photo when metadata is ambiguous', () => {
  expect(
    savedMealPhotoId(live, [saved, { ...saved, id: 'B'.repeat(43) }]),
  ).toBeUndefined();
});
