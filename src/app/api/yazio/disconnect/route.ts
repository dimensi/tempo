import { disconnectYazio } from '@/server/yazio/settings';
import { sameOrigin, respond, json } from '@/server/nutrition/http';
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    return json(await disconnectYazio(request.headers));
  });
}
