/** A single byte range; reject malformed/multipart input and unsatisfiable ranges. */
export function videoRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new RangeError('Invalid range');
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size ||
    (!match[1] && Number(match[2]) === 0)
  )
    throw new RangeError('Invalid range');
  return { start, end };
}
