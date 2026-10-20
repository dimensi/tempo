import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readServerEnv } from '@/server/env';

export class McpReadError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const payloadSchema = z.strictObject({
  binding: z.string(),
  offset: z.number().int().min(0).max(10000),
  expires: z.number().int(),
});
function sign(value: string) {
  const secret = readServerEnv().BETTER_AUTH_SECRET;
  if (!secret) throw new McpReadError('unavailable');
  return createHmac('sha256', secret)
    .update('tempo-mcp-cursor/v1:')
    .update(value)
    .digest('base64url');
}
export function readOffset(cursor: string | undefined, binding: string) {
  if (!cursor) return 0;
  try {
    const [value, signature, extra] = cursor.split('.');
    if (!value || !signature || extra) throw new Error();
    const expected = Buffer.from(sign(value));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new Error();
    const data = payloadSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString()),
    );
    if (data.binding !== binding || data.expires <= Date.now())
      throw new Error();
    return data.offset;
  } catch {
    throw new McpReadError('invalid_cursor');
  }
}
export function pageRows<T>(
  rows: T[],
  offset: number,
  limit: number,
  binding: string,
) {
  if (rows.length > 10000) throw new McpReadError('narrow_range');
  if (offset > rows.length) throw new McpReadError('invalid_cursor');
  const page: T[] = [];
  let bytes = 0;
  for (const row of rows.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (bytes + size > 48000) break;
    page.push(row);
    bytes += size;
  }
  if (!page.length && offset < rows.length)
    throw new McpReadError('use_summary');
  const next = offset + page.length;
  const value = Buffer.from(
    JSON.stringify({ binding, offset: next, expires: Date.now() + 3600000 }),
  ).toString('base64url');
  return {
    records: page,
    next_cursor: next < rows.length ? `${value}.${sign(value)}` : null,
  };
}
