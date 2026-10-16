import { jsonBody, respond } from '@/server/access/http';
import { createInvitation } from '@/server/access/trainers';
import { withApiErrors } from '@/server/auth/api-response';
async function POSTHandler(request: Request) {
  return respond(async () =>
    createInvitation(request.headers, await jsonBody(request)),
  );
}

export const POST = withApiErrors(POSTHandler);
