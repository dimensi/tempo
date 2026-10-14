import 'server-only';
import { Input, MP4, CustomSource } from 'mediabunny';
import {
  VIDEO_MAX_SECONDS,
  VIDEO_PART_BYTES,
} from '@/contracts/workout-videos';
/** Inspect media before publishing. Memory stays bounded to part/cache sizes; no decode on server. */
export async function validateWorkoutVideo(
  size: number,
  readPart: (part: number) => Promise<Uint8Array>,
) {
  const input = new Input({
    formats: [MP4],
    source: new CustomSource({
      getSize: () => size,
      maxCacheSize: VIDEO_PART_BYTES,
      async read(start, end) {
        const bytes = new Uint8Array(end - start);
        let position = start;
        while (position < end) {
          const part = await readPart(Math.floor(position / VIDEO_PART_BYTES));
          const offset = position % VIDEO_PART_BYTES;
          const length = Math.min(end - position, part.length - offset);
          if (length <= 0) throw new SyntaxError('Invalid video');
          bytes.set(part.subarray(offset, offset + length), position - start);
          position += length;
        }
        return bytes;
      },
    }),
  });
  try {
    const videos = await input.getVideoTracks(),
      audio = await input.getAudioTracks();
    const video = videos[0];
    if (
      videos.length !== 1 ||
      !video ||
      (await video.getCodec()) !== 'avc' ||
      audio.length > 1 ||
      (audio[0] && (await audio[0].getCodec()) !== 'aac')
    )
      throw new SyntaxError('Invalid video');
    const width = await video.getDisplayWidth(),
      height = await video.getDisplayHeight();
    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(undefined, {
      metadataOnly: true,
    });
    if (
      Math.max(width, height) > 1280 ||
      Math.min(width, height) > 720 ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > VIDEO_MAX_SECONDS + 0.1 ||
      !Number.isFinite(stats.averagePacketRate) ||
      stats.averagePacketRate > 30.5 ||
      stats.packetCount < 1 ||
      stats.packetCount > 9001
    )
      throw new SyntaxError('Invalid video');
    return Math.ceil(duration);
  } catch {
    throw new SyntaxError('Invalid video');
  } finally {
    input.dispose();
  }
}
