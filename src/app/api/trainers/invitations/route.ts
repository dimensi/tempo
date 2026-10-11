import { createInvitation } from '@/server/access/trainers';
import { respond, jsonBody } from '@/server/access/http';
export async function POST(request: Request) {
  return respond(async () =>
    createInvitation(request.headers, await jsonBody(request)),
  );
}
