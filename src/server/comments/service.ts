import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, asc } from 'drizzle-orm';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { comments } from '@/server/db/schema/comments';
import {
  commentScope,
  createCommentInput,
  updateCommentInput,
  type CommentDto,
} from '@/contracts/comments';
import { CollaborationError } from '@/server/access/http';
import { requireCommentTarget } from './targets';
async function access(headers: Headers, ownerId: string) {
  const auth = await authorize(headers, 'comments:write', ownerId);
  if (!auth.ok) throw new CollaborationError(auth.status);
  return auth.session.user.id;
}
export async function listComments(
  headers: Headers,
  raw: unknown,
): Promise<CommentDto[]> {
  const parsed = commentScope.safeParse(raw);
  if (!parsed.success) throw new CollaborationError(400);
  const { ownerId, target } = parsed.data;
  await access(headers, ownerId);
  await requireCommentTarget(ownerId, target);
  const viewerId = await access(headers, ownerId);
  return getDatabase()
    .db.select({ comment: comments, authorName: user.name })
    .from(comments)
    .innerJoin(user, eq(comments.authorId, user.id))
    .where(
      and(
        eq(comments.ownerId, ownerId),
        eq(comments.targetType, target.type),
        eq(comments.targetId, target.id),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all()
    .map(({ comment, authorName }) => ({
      id: comment.id,
      authorId: comment.authorId,
      authorName,
      body: comment.body,
      parentId: comment.parentId,
      createdAt: new Date(comment.createdAt).toISOString(),
      updatedAt: new Date(comment.updatedAt).toISOString(),
      canEdit: comment.authorId === viewerId,
    }));
}
export async function createComment(headers: Headers, raw: unknown) {
  const parsed = createCommentInput.safeParse(raw);
  if (!parsed.success) throw new CollaborationError(400);
  const { ownerId, target, body, parentId } = parsed.data;
  await access(headers, ownerId);
  await requireCommentTarget(ownerId, target);
  const authorId = await access(headers, ownerId);
  const db = getDatabase().db;
  if (parentId) {
    const parent = db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.id, parentId),
          eq(comments.ownerId, ownerId),
          eq(comments.targetType, target.type),
          eq(comments.targetId, target.id),
        ),
      )
      .get();
    if (!parent || parent.parentId) throw new CollaborationError(400);
  }
  const id = randomUUID();
  const now = Date.now();
  db.insert(comments)
    .values({
      id,
      ownerId,
      authorId,
      targetType: target.type,
      targetId: target.id,
      body,
      parentId: parentId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { id };
}
export async function changeComment(
  headers: Headers,
  id: string,
  raw: unknown,
  remove: boolean,
) {
  const schema = remove
    ? commentScope.pick({ ownerId: true })
    : updateCommentInput;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new CollaborationError(400);
  const input = parsed.data;
  const authorId = await access(headers, input.ownerId);
  const db = getDatabase().db;
  const row = db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.ownerId, input.ownerId)))
    .get();
  if (!row) throw new CollaborationError(404);
  if (row.authorId !== authorId) throw new CollaborationError(403);
  await requireCommentTarget(input.ownerId, {
    type: row.targetType,
    id: row.targetId,
  });
  const currentAuthorId = await access(headers, input.ownerId);
  if (row.authorId !== currentAuthorId) throw new CollaborationError(403);
  const own = and(
    eq(comments.id, id),
    eq(comments.ownerId, input.ownerId),
    eq(comments.authorId, authorId),
  );
  if (remove) {
    db.transaction((tx) => {
      tx.update(comments)
        .set({ parentId: null })
        .where(
          and(eq(comments.parentId, id), eq(comments.ownerId, input.ownerId)),
        )
        .run();
      tx.delete(comments).where(own).run();
    });
  } else
    db.update(comments)
      .set({
        body: ('body' in input ? input.body : '') as string,
        updatedAt: Date.now(),
      })
      .where(own)
      .run();
  return { updated: true };
}
