import { apiFetch } from '@/lib/api-client';
import type { SafeMealPhotoView } from '@/contracts/nutrition';
import type { DiaryPhoto } from './diary-view';

export function mealPhotoUrl(ownerId: string, id: string) {
  const query = new URLSearchParams({ ownerId });
  return `/api/nutrition/photos/${encodeURIComponent(id)}?${query}`;
}

export function diaryPhotos(
  ownerId: string,
  photos: SafeMealPhotoView[],
): DiaryPhoto[] {
  return photos.map((photo) => ({
    ...photo,
    href: mealPhotoUrl(ownerId, photo.id),
  }));
}

export function createPhotoActions(ownerId: string, onUpdated: () => void) {
  async function request(url: string, options: RequestInit) {
    const response = await apiFetch(url, options);
    if (!response.ok) throw new Error('Photo operation failed');
    // Finish the mutation response before a router refresh can replace the view.
    await response.json();
    onUpdated();
  }
  return {
    remove: (id: string) =>
      request(mealPhotoUrl(ownerId, id), { method: 'DELETE' }),
  };
}
