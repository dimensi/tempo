import { beforeEach, expect, it, vi } from 'vitest';
import { workoutMessages as m } from '@/features/workouts/messages';
const media = vi.hoisted(() => ({
  decode: vi.fn(),
  encode: vi.fn(),
  init: vi.fn(),
  cancel: vi.fn(),
  execute: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('mediabunny', () => ({
  Input: class {
    getPrimaryVideoTrack = async () => ({
      canDecode: media.decode,
      getDisplayWidth: async () => 1920,
      getDisplayHeight: async () => 1080,
    });
    computeDuration = async () => 2;
    getAudioTracks = async () => [];
    dispose = media.dispose;
  },
  ALL_FORMATS: [],
  BlobSource: class {},
  Output: class {},
  Mp4OutputFormat: class {},
  StreamTarget: class {},
  Quality: class {},
  canEncodeVideo: media.encode,
  Conversion: { init: media.init },
}));
const { compressWorkoutVideo } =
  await import('@/features/workouts/compress-video');
beforeEach(() => {
  vi.resetAllMocks();
  media.decode.mockResolvedValue(true);
  media.encode.mockResolvedValue(true);
  media.cancel.mockResolvedValue(undefined);
  media.execute.mockResolvedValue(undefined);
  media.init.mockResolvedValue({
    isValid: false,
    discardedTracks: [],
    cancel: media.cancel,
    execute: media.execute,
  });
});
const file = new File(['synthetic'], 'clip.mov');
it('rejects an unavailable encoder without returning the original or starting conversion', async () => {
  media.encode.mockResolvedValue(false);
  await expect(
    compressWorkoutVideo(file, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(m.videoUnsupported);
  expect(media.init).not.toHaveBeenCalled();
  expect(media.dispose).toHaveBeenCalledOnce();
  expect(media.encode).toHaveBeenCalledWith(
    'avc',
    expect.objectContaining({ width: 1280, height: 720, frameRate: 30 }),
  );
});
it('cancels resources when conversion cannot preserve required tracks', async () => {
  await expect(
    compressWorkoutVideo(file, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(m.videoUnsupported);
  expect(media.cancel).toHaveBeenCalledOnce();
  expect(media.execute).not.toHaveBeenCalled();
  expect(media.dispose).toHaveBeenCalledOnce();
});
it('cancels exactly once and disposes input after interruption', async () => {
  const abort = new AbortController();
  media.init.mockResolvedValue({
    isValid: true,
    discardedTracks: [],
    cancel: media.cancel,
    execute: media.execute,
  });
  media.execute.mockImplementation(async () => {
    abort.abort();
    throw new Error('interrupted');
  });
  await expect(
    compressWorkoutVideo(file, abort.signal, vi.fn()),
  ).rejects.toThrow('interrupted');
  expect(media.cancel).toHaveBeenCalledOnce();
  expect(media.dispose).toHaveBeenCalledOnce();
});
it('rejects oversized input before initializing conversion', async () => {
  const large = { size: 1024 * 1024 * 1024 + 1 } as File;
  await expect(
    compressWorkoutVideo(large, new AbortController().signal, vi.fn()),
  ).rejects.toThrow(m.videoInputLimit);
  expect(media.init).not.toHaveBeenCalled();
});
