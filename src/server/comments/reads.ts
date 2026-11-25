import 'server-only';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { CommentTarget } from '@/contracts/comments';
import { CollaborationError } from '@/server/access/http';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { comments } from '@/server/db/schema/comments';

async function requireRead(headers: Headers, ownerId: string) {
  const access = await authorize(headers, 'comments:read', ownerId);
  if (!access.ok) throw new CollaborationError(access.status);
}

/** Saved discussions, including replies and targets that may have been deleted. */
export async function listSavedComments(
  headers: Headers,
  ownerId: string,
  target?: CommentTarget,
) {
  await requireRead(headers, ownerId);
  const rows = getDatabase()
    .db.select({ comment: comments, authorName: user.name })
    .from(comments)
    .innerJoin(user, eq(comments.authorId, user.id))
    .where(
      and(
        eq(comments.ownerId, ownerId),
        target ? eq(comments.targetType, target.type) : undefined,
        target ? eq(comments.targetId, target.id) : undefined,
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(10001)
    .all();
  await requireRead(headers, ownerId);
  return rows.map(({ comment, authorName }) => ({
    id: comment.id,
    target: { type: comment.targetType, id: comment.targetId },
    authorId: comment.authorId,
    authorName,
    body: comment.body,
    parentId: comment.parentId,
    createdAt: new Date(comment.createdAt).toISOString(),
    updatedAt: new Date(comment.updatedAt).toISOString(),
  }));
}

/** Counts include roots and replies; no discussion bodies are loaded. */
export async function getCommentCounts(
  headers: Headers,
  ownerId: string,
  type: CommentTarget['type'],
  ids: string[],
) {
  await requireRead(headers, ownerId);
  if (ids.length === 0) return new Map<string, number>();
  const rows = getDatabase()
    .db.select({ id: comments.targetId, count: count() })
    .from(comments)
    .where(
      and(
        eq(comments.ownerId, ownerId),
        eq(comments.targetType, type),
        inArray(comments.targetId, [...new Set(ids)]),
      ),
    )
    .groupBy(comments.targetId)
    .all();
  await requireRead(headers, ownerId);
  return new Map(rows.map((row) => [row.id, row.count]));
}
