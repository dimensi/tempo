import { expect, it } from 'vitest';
import { videoRange } from '@/server/workouts/video-range';
it('supports bounded, open-ended and suffix ranges and rejects malformed/unsatisfiable requests', () => {
  expect(videoRange(null, 100)).toBeNull();
  expect(videoRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  expect(videoRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
  expect(videoRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
  expect(videoRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 });
  for (const range of [
    'bytes=100-',
    'bytes=9-1',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,4-5',
    'bytes=9007199254740993-',
    'bytes=1.5-',
  ])
    expect(() => videoRange(range, 100)).toThrow(RangeError);
});
