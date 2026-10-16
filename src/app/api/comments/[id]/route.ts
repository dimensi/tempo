import { jsonBody, respond } from '@/server/access/http';
import { withApiErrors } from '@/server/auth/api-response';
import { changeComment } from '@/server/comments/service';
import {
  configureCommentTargets,
  resolveCommentTarget,
} from '@/server/comments/targets';
type Context = { params: Promise<{ id: string }> };
async function PATCHHandler(request: Request, context: Context) {
  configureCommentTargets(resolveCommentTarget);
  return respond(async () =>
    changeComment(
      request.headers,
      (await context.params).id,
      await jsonBody(request),
      false,
    ),
  );
}
async function DELETEHandler(request: Request, context: Context) {
  configureCommentTargets(resolveCommentTarget);
  return respond(async () =>
    changeComment(
      request.headers,
      (await context.params).id,
      await jsonBody(request),
      true,
    ),
  );
}

export const PATCH = withApiErrors(PATCHHandler);

export const DELETE = withApiErrors(DELETEHandler);
