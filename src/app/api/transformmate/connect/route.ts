import { withApiErrors } from '@/server/auth/api-response';
import {
  connectTransformMate,
  transformMateOwner,
} from '@/server/transformmate/connection';
import {
  checkTransformMateOrigin,
  readTransformMateJson,
  transformMateResponse,
} from '@/server/transformmate/http';
async function POSTHandler(request: Request) {
  return transformMateResponse(async () => {
    checkTransformMateOrigin(request);
    await transformMateOwner(request.headers);
    return connectTransformMate(
      request.headers,
      await readTransformMateJson(request),
    );
  });
}

export const POST = withApiErrors(POSTHandler);
