import 'server-only';
import type { SafeMealPhotoView } from '@/contracts/nutrition';
import { ReportError } from '@/server/pdf/errors';

export function selectReportPhotos(
  photos: SafeMealPhotoView[],
): SafeMealPhotoView[] {
  const groups = new Map<string, SafeMealPhotoView[]>();
  for (const photo of photos) {
    const key = `${photo.date}/${photo.daytime}`;
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }
  return Array.from(groups.values()).map((group) => {
    const yazio = group.filter((photo) => photo.source === 'yazio');
    if (yazio.length > 1) throw new ReportError('INVALID', 422);
    if (yazio.length === 1) return yazio[0]!;
    return [...group].sort(
      (a, b) =>
        b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id),
    )[0]!;
  });
}
