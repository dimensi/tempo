import { jsonBody, respond } from '@/server/access/http';
import { withApiErrors } from '@/server/auth/api-response';
import { createComment, listComments } from '@/server/comments/service';
import {
  configureCommentTargets,
  resolveCommentTarget,
} from '@/server/comments/targets';
async function GETHandler(request: Request) {
  configureCommentTargets(resolveCommentTarget);
  const q = new URL(request.url).searchParams;
  return respond(() =>
    listComments(request.headers, {
      ownerId: q.get('ownerId'),
      target: { type: q.get('type'), id: q.get('targetId') },
    }),
  );
}
async function POSTHandler(request: Request) {
  configureCommentTargets(resolveCommentTarget);
  return respond(async () =>
    createComment(request.headers, await jsonBody(request)),
  );
}

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);
