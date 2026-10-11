import 'server-only';
import type { CommentTarget } from '@/contracts/comments';
import { CollaborationError } from '@/server/access/http';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { measurements } from '@/server/db/schema/measurements';
import { workoutSessions } from '@/server/db/schema/workouts';
import { nutritionDayExists } from '@/server/nutrition';
import { diaryDateSchema } from '@/contracts/nutrition';
export type CommentTargetResolver = (
  ownerId: string,
  target: CommentTarget,
  headers: Headers,
) => boolean | Promise<boolean>;
// Coordinator supplies the server-domain resolver once the domain schemas are integrated.
let resolver: CommentTargetResolver | undefined;
export function configureCommentTargets(value: CommentTargetResolver) {
  resolver = value;
}
export function resolveCommentTarget(
  ownerId: string,
  target: CommentTarget,
  headers: Headers,
) {
  if (target.type === 'nutrition_day')
    return diaryDateSchema.safeParse(target.id).success
      ? nutritionDayExists(headers, ownerId, target.id)
      : false;
  const table = target.type === 'measurement' ? measurements : workoutSessions;
  return !!getDatabase()
    .db.select({ id: table.id })
    .from(table)
    .where(and(eq(table.ownerId, ownerId), eq(table.id, target.id)))
    .get();
}
export async function requireCommentTarget(
  ownerId: string,
  target: CommentTarget,
  headers: Headers,
) {
  if (!resolver) throw new CollaborationError(503);
  if (!(await resolver(ownerId, target, headers)))
    throw new CollaborationError(404);
}
