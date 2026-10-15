import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from '@/contracts/workout-videos';
import { workoutMessages as m } from './messages';
export async function compressWorkoutVideo(
  file: File,
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  if (file.size > 1024 * 1024 * 1024) throw new Error(m.videoInputLimit);
  const {
    Input,
    ALL_FORMATS,
    BlobSource,
    Output,
    Mp4OutputFormat,
    StreamTarget,
    Conversion,
    canEncodeVideo,
    Quality,
  } = await import('mediabunny');
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  let completed = false;
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= conversion?.cancel();
    void cancellation?.catch(() => {});
  };
  signal.addEventListener('abort', cancel);
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    if (
      !track ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > VIDEO_MAX_SECONDS
    )
      throw new Error(m.videoDurationLimit);
    const naturalWidth = await track.getDisplayWidth(),
      naturalHeight = await track.getDisplayHeight();
    const scale = Math.min(
      1,
      1280 / Math.max(naturalWidth, naturalHeight),
      720 / Math.min(naturalWidth, naturalHeight),
    );
    const width = Math.max(2, Math.floor((naturalWidth * scale) / 2) * 2),
      height = Math.max(2, Math.floor((naturalHeight * scale) / 2) * 2);
    if (
      !(await track.canDecode()) ||
      !(await canEncodeVideo('avc', {
        width,
        height,
        frameRate: 30,
        quality: new Quality(0.6),
      }))
    )
      throw new Error(m.videoUnsupported);
    const pieces: BlobPart[] = [];
    let size = 0;
    const output = new Output({
      format: new Mp4OutputFormat({
        fastStart: 'fragmented',
        minimumFragmentDuration: 2,
      }),
      target: new StreamTarget(
        new WritableStream({
          write({ data, position }) {
            if (position !== size || size + data.length > VIDEO_MAX_BYTES)
              throw new Error(m.videoOutputLimit);
            pieces.push(data);
            size += data.length;
          },
        }),
      ),
    });
    conversion = await Conversion.init({
      input,
      output,
      video: (item) =>
        item === track
          ? {
              codec: 'avc',
              width,
              height,
              fit: 'contain',
              frameRate: 30,
              quality: new Quality(0.6),
              forceTranscode: true,
              keyFrameInterval: 2,
              allowTransformationMetadata: false,
            }
          : { discard: true },
      // Copy an existing AAC track without requiring an AAC encoder (unavailable
      // in Chromium on Linux); other audio codecs still require supported transcoding.
      audio: { codec: 'aac' },
      tags: {},
    });
    const audio = await input.getAudioTracks();
    if (
      !conversion.isValid ||
      conversion.discardedTracks.some(
        (item) =>
          item.track === track ||
          audio.includes(item.track as (typeof audio)[number]),
      )
    )
      throw new Error(m.videoUnsupported);
    signal.throwIfAborted();
    conversion.onProgress = (value) => progress(value);
    await conversion.execute();
    signal.throwIfAborted();
    completed = true;
    return { blob: new Blob(pieces, { type: 'video/mp4' }), duration };
  } catch (error) {
    if (signal.aborted) throw error;
    if (
      error instanceof Error &&
      (
        [
          m.videoInputLimit,
          m.videoDurationLimit,
          m.videoUnsupported,
          m.videoOutputLimit,
        ] as string[]
      ).includes(error.message)
    )
      throw error;
    throw new Error(m.videoUnsupported);
  } finally {
    signal.removeEventListener('abort', cancel);
    try {
      if (!completed) {
        cancel();
        await cancellation?.catch(() => {});
      }
    } finally {
      input.dispose();
    }
  }
}
