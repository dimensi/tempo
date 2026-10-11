import { disconnectYazio, yazioOwner } from '@/server/yazio/settings';
import { sameOrigin, respond, json, readBody } from '@/server/nutrition/http';
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    await yazioOwner(request.headers);
    return json(
      await disconnectYazio(
        request.headers,
        JSON.parse((await readBody(request, 2048)).toString()),
      ),
    );
  });
}
