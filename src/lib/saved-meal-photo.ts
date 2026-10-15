import type { SafeMealPhotoView } from '@/contracts/nutrition';
import type { OfflineSnapshot } from '@/contracts/offline';
/** Opaque cache IDs are intentionally unrelated to live photo IDs. Match safe metadata. */
export function savedMealPhotoId(
  photo: SafeMealPhotoView,
  saved: OfflineSnapshot['photos']['items'],
) {
  const matches = saved.filter(
    (item) =>
      item.date === photo.date &&
      item.daytime === photo.daytime &&
      item.source === photo.source &&
      item.observedAt === photo.observedAt,
  );
  return matches.length === 1 ? matches[0]!.id : undefined;
}
