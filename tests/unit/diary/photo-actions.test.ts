import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPhotoActions,
  diaryPhotos,
} from '@/features/nutrition/ui/photo-actions';

afterEach(() => vi.unstubAllGlobals());
describe('authorized photo transport', () => {
  it('uses local scoped URLs and sends raw image bytes with the declared MIME type', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    const updated = vi.fn();
    const actions = createPhotoActions('owner&scope', updated);
    const file = new File(['synthetic'], 'photo.webp', { type: 'image/webp' });
    await actions.upload('2026-01-01', 'lunch', file);
    expect(fetch).toHaveBeenCalledWith(
      '/api/nutrition/photos?ownerId=owner%26scope&date=2026-01-01&daytime=lunch',
      { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: file },
    );
    await actions.remove('photo/id');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/nutrition/photos/photo%2Fid?ownerId=owner%26scope',
      { method: 'DELETE' },
    );
    expect(updated).toHaveBeenCalledTimes(2);
    expect(
      diaryPhotos('owner&scope', [
        {
          id: 'photo/id',
          source: 'manual',
          date: '2026-01-01',
          daytime: 'lunch',
          observedAt: '2026-01-01T00:00:00Z',
        },
      ])[0]?.href,
    ).toBe('/api/nutrition/photos/photo%2Fid?ownerId=owner%26scope');
  });
  it('does not refresh on a rejected mutation or expose the upstream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => 'private details',
      }),
    );
    const updated = vi.fn();
    await expect(
      createPhotoActions('owner', updated).remove('photo'),
    ).rejects.toThrow('Photo operation failed');
    expect(updated).not.toHaveBeenCalled();
  });
});
