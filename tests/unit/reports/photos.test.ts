import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { selectReportPhotos } from '@/server/pdf/photos';
import type { SafeMealPhotoView } from '@/contracts/nutrition';
const photo = (id: string, source: 'manual' | 'yazio'): SafeMealPhotoView => ({
  id,
  source,
  date: '2026-10-11',
  daytime: 'breakfast',
  observedAt: '2026-10-11T12:00:00Z',
});
it('uses the single YAZIO meal photo without adding unrelated manual photos', () => {
  const yazio = photo('yazio', 'yazio');
  expect(
    selectReportPhotos([
      photo('manual-1', 'manual'),
      yazio,
      photo('manual-2', 'manual'),
    ]),
  ).toEqual([yazio]);
  const manual = photo('manual', 'manual');
  expect(selectReportPhotos([manual])).toEqual([manual]);
});
it('uses the latest manual image with a stable id tie-break and rejects duplicate upstream images', () => {
  const latest = {
    ...photo('latest', 'manual'),
    observedAt: '2026-10-11T13:00:00Z',
  };
  expect(selectReportPhotos([latest, photo('older', 'manual')])).toEqual([
    latest,
  ]);
  expect(
    selectReportPhotos([photo('b', 'manual'), photo('a', 'manual')])[0]!.id,
  ).toBe('a');
  expect(() =>
    selectReportPhotos([photo('one', 'yazio'), photo('two', 'yazio')]),
  ).toThrow('INVALID');
});
