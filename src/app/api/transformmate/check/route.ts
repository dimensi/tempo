import { withApiErrors } from '@/server/auth/api-response';
import {
  checkTransformMate,
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
    return checkTransformMate(
      request.headers,
      await readTransformMateJson(request),
    );
  });
}

export const POST = withApiErrors(POSTHandler);
