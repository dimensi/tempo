import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPhotoActions,
  diaryPhotos,
} from '@/features/nutrition/ui/photo-actions';

afterEach(() => vi.unstubAllGlobals());
describe('authorized photo transport', () => {
  it('refreshes only after the response body finishes', async () => {
    let finish!: () => void;
    const body = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const json = vi.fn(() => body);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));
    const updated = vi.fn();
    const operation = createPhotoActions('owner', updated).remove('photo');
    await Promise.resolve();
    expect(json).toHaveBeenCalledOnce();
    expect(updated).not.toHaveBeenCalled();
    finish();
    await operation;
    expect(updated).toHaveBeenCalledOnce();
  });
  it('uses local scoped removal and preserves URLs for existing photos', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    const updated = vi.fn();
    const actions = createPhotoActions('owner&scope', updated);
    await actions.remove('photo/id');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/nutrition/photos/photo%2Fid?ownerId=owner%26scope',
      { method: 'DELETE' },
    );
    expect(updated).toHaveBeenCalledTimes(1);
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

vi.mock('@/lib/api-client', () => ({
  apiFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));
