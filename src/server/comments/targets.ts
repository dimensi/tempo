import 'server-only';
import type { CommentTarget } from '@/contracts/comments';
import { CollaborationError } from '@/server/access/http';
export type CommentTargetResolver = (
  ownerId: string,
  target: CommentTarget,
) => boolean | Promise<boolean>;
// Coordinator supplies the server-domain resolver once the domain schemas are integrated.
let resolver: CommentTargetResolver | undefined;
export function configureCommentTargets(value: CommentTargetResolver) {
  resolver = value;
}
export async function requireCommentTarget(
  ownerId: string,
  target: CommentTarget,
) {
  if (!resolver) throw new CollaborationError(503);
  if (!(await resolver(ownerId, target))) throw new CollaborationError(404);
}
