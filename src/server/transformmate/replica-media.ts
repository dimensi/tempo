import 'server-only';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ObjectStorage } from '@/server/storage';
import type { CatalogScope } from './catalog-cache';
import type { PersistedDetail } from './catalog-projection';
import { selectMediaUrl } from './catalog-schema';
import { selectPreviewUrl, matchesSignature } from './preview-validation';
import { ReplicaMediaError, ReplicaStorageError } from './replica-gate';
import { TransformMateApiError } from './errors';
import {
  replicaStore,
  monthFrom,
  type ReplicaJob,
  type ReplicaObject,
} from './replica-store';
const exec = promisify(execFile);
export const replicaTemporaryRoot = () =>
  join(
    tmpdir(),
    'transformmate-replica-work',
    createHash('sha256').update(process.cwd()).digest('hex'),
  );
export const MAX_VIDEO_BYTES = 1024 ** 3;
const hash = (s: string | Uint8Array) =>
  createHash('sha256').update(s).digest('hex');
export function selectedVideo(detail: PersistedDetail) {
  const variants = (detail.kinescope_data ?? []).filter((m) =>
    selectMediaUrl({ kinescope_data: [m] }),
  );
  const area = (s: string | null) => {
    const match = s?.match(/^(\d+)x(\d+)$/);
    return match ? Number(match[1]) * Number(match[2]) : 0;
  };
  variants.sort(
    (a, b) =>
      area(b.resolution) - area(a.resolution) ||
      (b.file_size ?? 0) - (a.file_size ?? 0) ||
      (a.id ?? a.url ?? '').localeCompare(b.id ?? b.url ?? ''),
  );
  const media = variants[0];
  if (!media) return null;
  const url = selectMediaUrl({ kinescope_data: [media] })!;
  // Signed query parameters are transport credentials, never version identity.
  const fingerprint = hash(
    JSON.stringify([
      media.id,
      url.origin + url.pathname,
      media.resolution,
      media.file_size ?? null,
      media.created_at ?? null,
    ]),
  );
  return {
    url,
    fingerprint,
    reliable: Boolean(media.id && (media.created_at || media.file_size)),
    resolution: media.resolution,
  };
}
async function checkedFetch(url: URL, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(15 * 60000),
  });
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    const retry = response.headers.get('retry-after');
    const retryAfterMs =
      retry && /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : retry
          ? Math.max(0, Date.parse(retry) - Date.now())
          : undefined;
    throw new TransformMateApiError({
      status: response.status,
      statusText: '',
      isJson: false,
      body: null,
      contentType: '',
      retryAfterMs,
    });
  }
  return response;
}
async function writeBounded(
  body: ReadableStream<Uint8Array>,
  path: string,
  max: number,
  expected?: number,
) {
  let bytes = 0;
  const reader = body.getReader();
  await pipeline(
    Readable.from(
      (async function* () {
        let completed = false;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) {
              completed = true;
              break;
            }
            bytes += chunk.value.byteLength;
            if (bytes > max) throw new ReplicaMediaError();
            yield chunk.value;
          }
          if (!bytes || (expected !== undefined && bytes !== expected))
            throw new ReplicaMediaError();
        } finally {
          if (!completed) await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      })(),
    ),
    createWriteStream(path, { mode: 0o600 }),
  );
}

export async function generateReplicaPoster(video: string, output: string) {
  await exec(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-i',
      video,
      '-vf',
      "thumbnail=50,scale='min(960,iw)':-2",
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      output,
    ],
    { timeout: 60000, maxBuffer: 65536 },
  );
}
export async function validateReplicaVideo(path: string) {
  const { stdout } = await exec(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_type,width,height:format=format_name',
      '-of',
      'json',
      path,
    ],
    { timeout: 60000, maxBuffer: 65536 },
  );
  const value = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { format_name?: string };
  };
  if (
    !value.format?.format_name?.split(',').includes('mp4') ||
    !value.streams?.some((s) => (s.width ?? 0) > 0 && (s.height ?? 0) > 0)
  )
    throw new ReplicaMediaError();
}
export async function processReplicaMedia(
  scope: CatalogScope,
  job: ReplicaJob,
  detail: PersistedDetail,
  storage: ObjectStorage,
  save: () => Promise<void>,
  now: number,
) {
  const store = replicaStore();
  const nextCheckAt =
    job.data.detailAt > now ? job.data.detailAt : monthFrom(now);
  const root = replicaTemporaryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'job-'));
  const file = join(directory, 'video.mp4');
  let localVideo = false;
  const prefix = `transformmate/${hash(scope.ownerId)}/${scope.accountScope}`;
  async function persist(
    kind: 'video' | 'image' | 'poster',
    path: string,
    type: string,
    fingerprint: string,
    etag: string | null = null,
    modified: string | null = null,
  ) {
    const bytes = await stat(path);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    const key = `${prefix}/${digest.digest('hex')}.${kind === 'video' ? 'mp4' : kind === 'poster' ? 'jpg' : 'image'}`;
    await scope.assertUpstreamCurrent();
    store.garbage(key, Date.now() + 3600000);
    try {
      await storage.putStream(key, createReadStream(path), bytes.size, type);
    } catch {
      throw new ReplicaStorageError();
    }
    await scope.assertUpstreamCurrent();
    const object: ReplicaObject = {
      key,
      size: bytes.size,
      type,
      fingerprint,
      etag,
      modified,
    };
    job.data[`${kind}At`] = nextCheckAt;
    if (kind === 'video') job.data.posterAt = 0;
    store.publish(scope, job, kind, object, Date.now());
    store.garbageDone(key);
  }
  try {
    let failure: unknown;
    try {
      if (job.data.imageAt <= now) {
        const url = selectPreviewUrl(detail.image);
        if (url) {
          await scope.assertUpstreamCurrent();
          const current = job.data.image;
          const response = await checkedFetch(url, {
            signal: AbortSignal.timeout(10000),
            headers:
              current?.fingerprint === hash(url.href)
                ? {
                    ...(current.etag ? { 'If-None-Match': current.etag } : {}),
                    ...(current.modified
                      ? { 'If-Modified-Since': current.modified }
                      : {}),
                  }
                : {},
          });
          try {
            if ([401, 403, 404, 410].includes(response.status)) {
              job.data.detailAt = 0;
              await save();
              throw new ReplicaMediaError();
            }
            if (response.status !== 304 || !current) {
              const type =
                response.headers.get('content-type')?.split(';')[0]?.trim() ??
                '';
              if (
                response.status !== 200 ||
                ![
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/avif',
                ].includes(type) ||
                !response.body
              )
                throw new ReplicaMediaError();
              const imagePath = join(directory, 'image');
              await writeBounded(response.body, imagePath, 5 * 1024 ** 2);
              if (!matchesSignature(await readFile(imagePath), type))
                throw new ReplicaMediaError();
              await persist(
                'image',
                imagePath,
                type,
                hash(url.href),
                response.headers.get('etag'),
                response.headers.get('last-modified'),
              );
            }
          } finally {
            await response.body?.cancel().catch(() => {});
          }
        }
        job.data.imageAt = nextCheckAt;
        await save();
      }
    } catch (error) {
      if (error instanceof ReplicaStorageError) throw error;
      failure = error;
    }
    const selected = selectedVideo(detail);
    try {
      if (job.data.videoAt <= now) {
        if (selected) {
          const current = job.data.video;
          if (
            !current ||
            current.fingerprint !== selected.fingerprint ||
            !selected.reliable ||
            Boolean(current?.etag || current?.modified)
          ) {
            await scope.assertUpstreamCurrent();
            const response = await checkedFetch(selected.url, {
              headers:
                current?.fingerprint === selected.fingerprint
                  ? {
                      ...(current.etag
                        ? { 'If-None-Match': current.etag }
                        : {}),
                      ...(current.modified
                        ? { 'If-Modified-Since': current.modified }
                        : {}),
                    }
                  : {},
            });
            try {
              if ([401, 403, 404, 410].includes(response.status)) {
                job.data.detailAt = 0;
                await save();
                throw new ReplicaMediaError();
              }
              if (response.status !== 304 || !current) {
                const declared = response.headers.get('content-length');
                if (
                  response.status !== 200 ||
                  response.headers
                    .get('content-type')
                    ?.split(';')[0]
                    ?.trim() !== 'video/mp4' ||
                  !response.body ||
                  (declared &&
                    (!/^\d+$/.test(declared) ||
                      Number(declared) > MAX_VIDEO_BYTES))
                )
                  throw new ReplicaMediaError();
                await writeBounded(
                  response.body,
                  file,
                  MAX_VIDEO_BYTES,
                  declared ? Number(declared) : undefined,
                );
                await validateReplicaVideo(file);
                await persist(
                  'video',
                  file,
                  'video/mp4',
                  selected.fingerprint,
                  response.headers.get('etag'),
                  response.headers.get('last-modified'),
                );
                localVideo = true;
                job.data.posterAt = 0;
              }
            } finally {
              await response.body?.cancel().catch(() => {});
            }
          }
        }
        job.data.videoAt = nextCheckAt;
        await save();
      }
    } catch (error) {
      if (error instanceof ReplicaStorageError) throw error;
      failure = error;
    }
    try {
      if (job.data.posterAt <= now) {
        if (
          job.data.video &&
          job.data.poster?.fingerprint !== job.data.video.key
        ) {
          if (!localVideo) {
            try {
              const object = await storage.readStream(job.data.video.key);
              await writeBounded(
                object.body,
                file,
                MAX_VIDEO_BYTES,
                job.data.video.size,
              );
            } catch {
              throw new ReplicaStorageError();
            }
          }
          const poster = join(directory, 'poster.jpg');
          try {
            await generateReplicaPoster(file, poster);
          } catch {
            throw new ReplicaMediaError();
          }
          await persist('poster', poster, 'image/jpeg', job.data.video.key);
        }
        job.data.posterAt = nextCheckAt;
        await save();
      }
    } catch (error) {
      if (error instanceof ReplicaStorageError) throw error;
      failure = error;
    }
    if (failure) throw failure;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
