import { nutritionSyncMessages as messages } from '@/contracts/nutrition-sync';
import { withApiErrors } from '@/server/auth/api-response';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import {
  connectYazio,
  YazioConnectionUnavailableError,
} from '@/server/yazio/connection';
import { yazioOwner } from '@/server/yazio/settings';

async function POSTHandler(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    await yazioOwner(request.headers);
    try {
      return json(
        await connectYazio(
          request.headers,
          JSON.parse((await readBody(request, 8192)).toString()),
        ),
      );
    } catch (error) {
      if (error instanceof YazioConnectionUnavailableError)
        return json({ error: messages.storeUnavailable }, 503);
      throw error;
    }
  });
}

export const POST = withApiErrors(POSTHandler);
