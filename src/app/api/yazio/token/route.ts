import { withApiErrors } from '@/server/auth/api-response';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import { saveExistingToken, yazioOwner } from '@/server/yazio/settings';
async function POSTHandler(request: Request) {
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

export const POST = withApiErrors(POSTHandler);
