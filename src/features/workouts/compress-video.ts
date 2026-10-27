import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from '@/contracts/workout-videos';
import { workoutMessages as m } from './messages';
export class WorkoutVideoCompressionError extends Error {
  constructor(
    message: string,
    readonly diagnostic: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'WorkoutVideoCompressionError';
  }
}
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
  let stage = 'metadata';
  const details: Record<string, unknown> = {
    inputType: file.type,
    inputBytes: file.size,
  };
  const failure = (message: string, cause?: unknown) =>
    new WorkoutVideoCompressionError(
      message,
      JSON.stringify(
        {
          ...details,
          stage,
          error: cause instanceof Error ? cause.name : undefined,
          message:
            cause instanceof Error ? cause.message.slice(0, 500) : undefined,
        },
        null,
        2,
      ),
      cause,
    );
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= conversion?.cancel();
    void cancellation?.catch(() => {});
  };
  signal.addEventListener('abort', cancel);
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw failure(m.videoNoTrack);
    // iPhone Spatial Audio also carries an auxiliary APAC track. Prefer the
    // compatible AAC soundtrack and never require its spatial alternative.
    const audio =
      (await input.getPrimaryAudioTrack({
        filter: async (item) => (await item.getCodec()) === 'aac',
      })) ?? (await input.getPrimaryAudioTrack());
    const duration = await input.computeDuration(
      audio ? [track, audio] : [track],
    );
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > VIDEO_MAX_SECONDS
    )
      throw new Error(m.videoDurationLimit);
    const naturalWidth = await track.getDisplayWidth(),
      naturalHeight = await track.getDisplayHeight();
    details.videoCodec = await track.getCodec();
    details.videoWidth = naturalWidth;
    details.videoHeight = naturalHeight;
    if (audio) {
      details.audioCodec = await audio.getCodec();
      details.audioChannels = await audio.getNumberOfChannels();
    }
    const scale = Math.min(
      1,
      1280 / Math.max(naturalWidth, naturalHeight),
      720 / Math.min(naturalWidth, naturalHeight),
    );
    const width = Math.max(2, Math.floor((naturalWidth * scale) / 2) * 2),
      height = Math.max(2, Math.floor((naturalHeight * scale) / 2) * 2);
    stage = 'video_decode';
    if (!(await track.canDecode())) throw failure(m.videoDecodeError);
    stage = 'video_encode';
    const quality = new Quality({ quality: 0.6, preferBitrate: true });
    if (
      !(await canEncodeVideo('avc', {
        width,
        height,
        frameRate: 30,
        quality,
      }))
    )
      throw failure(m.videoEncodeError);
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
            if (position !== size)
              throw failure(
                m.videoContainerError,
                new Error('Non-sequential MP4 output'),
              );
            if (size + data.length > VIDEO_MAX_BYTES)
              throw new Error(m.videoOutputLimit);
            pieces.push(data);
            size += data.length;
          },
        }),
      ),
    });
    stage = 'prepare_conversion';
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
              quality,
              forceTranscode: true,
              keyFrameInterval: 2,
              allowTransformationMetadata: false,
            }
          : { discard: true },
      // Keep one compatible soundtrack. AAC can be copied without an encoder;
      // multichannel primary sound is downmixed, while auxiliary tracks are excluded.
      audio: async (item) =>
        item === audio
          ? {
              codec: 'aac',
              numberOfChannels: Math.min(2, await item.getNumberOfChannels()),
            }
          : { discard: true },
      tags: {},
    });
    const discardedVideo = conversion.discardedTracks.find(
      (item) => item.track === track,
    );
    if (discardedVideo) {
      details.reason = discardedVideo.reason;
      throw failure(
        discardedVideo.reason === 'no_encodable_target_codec'
          ? m.videoEncodeError
          : m.videoDecodeError,
      );
    }
    const discardedAudio = conversion.discardedTracks.find(
      (item) => item.track === audio,
    );
    if (discardedAudio) {
      details.reason = discardedAudio.reason;
      throw failure(
        discardedAudio.reason === 'no_encodable_target_codec'
          ? m.videoAudioEncodeError
          : m.videoAudioDecodeError,
      );
    }
    if (!conversion.isValid) throw failure(m.videoUnsupported);
    signal.throwIfAborted();
    conversion.onProgress = (value) => progress(value);
    stage = 'convert';
    await conversion.execute();
    signal.throwIfAborted();
    completed = true;
    return { blob: new Blob(pieces, { type: 'video/mp4' }), duration };
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof WorkoutVideoCompressionError) throw error;
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
    const message =
      stage === 'metadata'
        ? m.videoReadError
        : stage === 'video_decode'
          ? m.videoDecodeError
          : stage === 'video_encode'
            ? m.videoEncodeError
            : m.videoUnsupported;
    throw failure(message, error);
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
