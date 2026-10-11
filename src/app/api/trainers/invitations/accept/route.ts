import { acceptInvitation } from '@/server/access/trainers';
import { respond, jsonBody } from '@/server/access/http';
export async function POST(request: Request) {
  return respond(async () => acceptInvitation(await jsonBody(request)));
}
