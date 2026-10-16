import { withApiErrors } from '@/server/auth/api-response';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import { disconnectYazio, yazioOwner } from '@/server/yazio/settings';
async function POSTHandler(request: Request) {
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

export const POST = withApiErrors(POSTHandler);
