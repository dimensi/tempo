import 'server-only';
import { spawn, execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import {
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_PART_BYTES,
} from '@/contracts/workout-videos';

const exec = promisify(execFile);
const formats = 'mov,matroska,webm,avi';
export const workoutVideoTemporaryRoot = () =>
  join(
    tmpdir(),
    'tempo-workout-video',
    createHash('sha256').update(process.cwd()).digest('hex'),
  );
export class VideoProcessingError extends Error {
  constructor(readonly code: 'invalid' | 'processing') {
    super(code);
  }
}
interface MediaInfo {
  streams?: {
    index: number;
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    channels?: number;
    color_transfer?: string;
    avg_frame_rate?: string;
    duration?: string;
    disposition?: { attached_pic?: number; default?: number };
    tags?: { creation_time?: string };
  }[];
  format?: { duration?: string; tags?: { creation_time?: string } };
}
async function inspect(path: string, signal: AbortSignal): Promise<MediaInfo> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        formats,
        '-show_entries',
        'stream=index,codec_type,codec_name,width,height,channels,color_transfer,avg_frame_rate,duration:stream_disposition=attached_pic,default:stream_tags=creation_time:format=duration:format_tags=creation_time',
        '-of',
        'json',
        path,
      ],
      { signal, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 },
    );
    return JSON.parse(stdout) as MediaInfo;
  } catch {
    signal.throwIfAborted();
    throw new VideoProcessingError('invalid');
  }
}
function date(value: string | undefined) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time >= 0 && time <= Date.now() + 86_400_000
    ? time
    : null;
}
async function encode(
  args: string[],
  duration: number,
  signal: AbortSignal,
  progress: (value: number) => void,
) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      signal,
      killSignal: 'SIGKILL',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending = (pending + chunk).slice(-8192);
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line);
        if (match)
          progress(Math.min(0.99, Number(match[1]) / 1_000_000 / duration));
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new VideoProcessingError('processing'));
    });
  });
}
/** One bounded job at a time. Raw parts and output are streamed, never buffered as a whole. */
export async function transcodeWorkoutVideo(
  source: {
    size: number;
    readPart: (part: number) => Promise<Uint8Array>;
    signal: AbortSignal;
    progress: (value: number) => void;
  },
  publish: (output: {
    body: AsyncIterable<Uint8Array>;
    size: number;
    duration: number;
    recordedAt: number | null;
  }) => Promise<void>,
) {
  const root = workoutVideoTemporaryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'job-'));
  const input = join(directory, 'source');
  const output = join(directory, 'video.mp4');
  try {
    async function* parts() {
      for (
        let part = 0;
        part < Math.ceil(source.size / VIDEO_PART_BYTES);
        part++
      ) {
        source.signal.throwIfAborted();
        const bytes = await source.readPart(part);
        if (
          bytes.length !==
          Math.min(VIDEO_PART_BYTES, source.size - part * VIDEO_PART_BYTES)
        )
          throw new VideoProcessingError('invalid');
        yield bytes;
      }
    }
    await pipeline(
      Readable.from(parts()),
      createWriteStream(input, { mode: 0o600 }),
      { signal: source.signal },
    );
    const media = await inspect(input, source.signal);
    const streams = media.streams ?? [];
    const video = streams.find(
      (item) => item.codec_type === 'video' && !item.disposition?.attached_pic,
    );
    const audioTracks = streams.filter((item) => item.codec_type === 'audio');
    const audio =
      audioTracks.find((item) => item.codec_name === 'aac') ??
      audioTracks.find((item) => item.disposition?.default) ??
      audioTracks[0];
    const duration = Math.max(
      Number(video?.duration ?? media.format?.duration),
      Number(audio?.duration ?? 0),
    );
    if (
      !video ||
      !(video.width! > 0) ||
      !(video.height! > 0) ||
      Math.max(video.width!, video.height!) > 8192 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > VIDEO_MAX_SECONDS + 0.1
    )
      throw new VideoProcessingError('invalid');
    // Scale after FFmpeg's display-matrix autorotation, including portrait iPhone MOVs.
    const filters = [
      "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2",
      'setsar=1',
      'fps=30',
      ...(['smpte2084', 'arib-std-b67'].includes(video.color_transfer ?? '')
        ? [
            'zscale=transfer=linear:npl=100',
            'format=gbrpf32le',
            'zscale=primaries=bt709',
            'tonemap=mobius',
            'zscale=transfer=bt709:matrix=bt709:range=limited',
          ]
        : []),
      'format=yuv420p',
    ];
    await encode(
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-threads',
        '2',
        '-filter_threads',
        '1',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        formats,
        '-i',
        input,
        '-map',
        `0:${video.index}`,
        ...(audio ? ['-map', `0:${audio.index}`] : ['-an']),
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-vf',
        filters.join(','),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-maxrate',
        '2500k',
        '-bufsize',
        '5000k',
        '-threads',
        '2',
        ...(audio
          ? [
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-ac',
              String(Math.min(2, audio.channels || 2)),
            ]
          : []),
        '-t',
        String(VIDEO_MAX_SECONDS),
        '-fs',
        String(VIDEO_MAX_BYTES + 1),
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        output,
      ],
      duration,
      source.signal,
      source.progress,
    );
    const size = (await stat(output)).size;
    if (!size || size > VIDEO_MAX_BYTES)
      throw new VideoProcessingError('invalid');
    const result = await inspect(output, source.signal);
    const resultVideo =
      result.streams?.filter((item) => item.codec_type === 'video') ?? [];
    const resultAudio =
      result.streams?.filter((item) => item.codec_type === 'audio') ?? [];
    const savedDuration = Number(result.format?.duration);
    const track = resultVideo[0];
    const [rate, divisor] = (track?.avg_frame_rate ?? '0/1')
      .split('/')
      .map(Number);
    if (
      resultVideo.length !== 1 ||
      track?.codec_name !== 'h264' ||
      Math.max(track.width ?? 0, track.height ?? 0) > 1280 ||
      Math.min(track.width ?? 0, track.height ?? 0) > 720 ||
      !Number.isFinite(savedDuration) ||
      savedDuration <= 0 ||
      savedDuration > VIDEO_MAX_SECONDS + 0.1 ||
      !divisor ||
      rate! / divisor > 30.5 ||
      resultAudio.length !== (audio ? 1 : 0) ||
      resultAudio.some(
        (item) => item.codec_name !== 'aac' || (item.channels ?? 0) > 2,
      )
    )
      throw new VideoProcessingError('invalid');
    source.signal.throwIfAborted();
    await publish({
      body: createReadStream(output),
      size,
      duration: Math.ceil(savedDuration),
      recordedAt: date(
        video.tags?.creation_time ?? media.format?.tags?.creation_time,
      ),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
