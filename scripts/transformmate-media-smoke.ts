import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import {
  generateReplicaPoster,
  validateReplicaVideo,
} from '../src/server/transformmate/replica-media';
import { getObjectStorage } from '../src/server/storage';
import { transcodeWorkoutVideo } from '../src/server/workouts/video-processing';
// Synthetic, disposable runtime rehearsal. Never uses TransformMate credentials.
const directory = await mkdtemp(join(tmpdir(), 'replica-smoke-'));
try {
  const video = join(directory, 'synthetic.mp4'),
    poster = join(directory, 'poster.jpg');
  await promisify(execFile)(
    'ffmpeg',
    [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=10',
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-y',
      video,
    ],
    { timeout: 60000 },
  );
  await validateReplicaVideo(video);
  await generateReplicaPoster(video, poster);
  const image = await readFile(poster);
  assert.equal(image[0], 0xff);
  assert.equal(image[1], 0xd8);
  const bytes = await readFile(video),
    storage = getObjectStorage(),
    key = 'transformmate/smoke/synthetic.mp4';
  let converted = false;
  await transcodeWorkoutVideo(
    {
      size: bytes.length,
      readPart: async () => bytes,
      signal: new AbortController().signal,
      progress: () => {},
    },
    async (output) => {
      let count = 0;
      for await (const part of output.body) count += part.length;
      assert.equal(count, output.size);
      assert.ok(output.duration >= 1 && output.duration <= 2);
      converted = true;
    },
  );
  assert.ok(converted);
  try {
    await storage.putStream(
      key,
      createReadStream(video),
      bytes.length,
      'video/mp4',
    );
    const object = await storage.readStream(key, { start: 0, end: 15 });
    assert.deepEqual(
      Buffer.from(await new Response(object.body).arrayBuffer()),
      bytes.subarray(0, 16),
    );
  } finally {
    await storage.remove(key);
  }
  console.log(
    'Media smoke: FFmpeg poster, workout transcode and persisted Range passed',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
