import 'server-only';
import { createHash } from 'node:crypto';
import type { CommentTarget } from '@/contracts/comments';
import type { McpCommentsInput } from '@/contracts/mcp';
import { authorize } from '@/server/auth/guards';
import { listSavedComments } from '@/server/comments/reads';
import { McpReadError, pageRows, readOffset } from './pagination';

export function commentReference(target: CommentTarget, count: number) {
  return { count, details: { tool: 'get_comments', arguments: { target } } };
}

export async function readMcpComments(
  headers: Headers,
  ownerId: string,
  input: McpCommentsInput,
) {
  async function check() {
    const access = await authorize(headers, 'comments:read', ownerId);
    if (!access.ok || access.session.user.role !== 'OWNER')
      throw new McpReadError('access_denied');
  }
  await check();
  // Canonical target fields keep JSON object-key order out of cursor bindings.
  const target = input.target
    ? { type: input.target.type, id: input.target.id }
    : null;
  const binding = createHash('sha256')
    .update(JSON.stringify([ownerId, 'get_comments', target]))
    .digest('hex');
  const offset = readOffset(input.cursor, binding);
  const rows = await listSavedComments(headers, ownerId, input.target);
  const page = pageRows(rows, offset, input.limit, binding);
  await check();
  return {
    version: 1 as const,
    data: {
      source: 'LOCAL',
      target,
      total: rows.length,
      order: 'createdAt_asc_id_asc',
      coverage: { scope: 'saved_tempo_comments', includesReplies: true },
      records: page.records,
    },
    next_cursor: page.next_cursor,
  };
}
