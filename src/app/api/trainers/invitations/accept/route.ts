import { jsonBody, respond } from '@/server/access/http';
import { acceptInvitation } from '@/server/access/trainers';
import { withApiErrors } from '@/server/auth/api-response';
async function POSTHandler(request: Request) {
  return respond(async () => acceptInvitation(await jsonBody(request)));
}

export const POST = withApiErrors(POSTHandler);
