import type { MealKind, SafeMealPhotoView } from '@/contracts/nutrition';
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
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Photo operation failed');
    onUpdated();
  }
  return {
    upload: (date: string, daytime: MealKind, file: File) => {
      const query = new URLSearchParams({ ownerId, date, daytime });
      return request(`/api/nutrition/photos?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
    },
    remove: (id: string) =>
      request(mealPhotoUrl(ownerId, id), { method: 'DELETE' }),
  };
}
