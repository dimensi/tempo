import { saveExistingToken, yazioOwner } from '@/server/yazio/settings';
import { json, respond, sameOrigin, readBody } from '@/server/nutrition/http';
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    await yazioOwner(request.headers);
    return json(
      await saveExistingToken(
        request.headers,
        JSON.parse((await readBody(request, 16384)).toString()),
      ),
    );
  });
}
