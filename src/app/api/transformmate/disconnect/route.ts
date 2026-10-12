import {
  disconnectTransformMate,
  transformMateOwner,
} from '@/server/transformmate/connection';
import {
  checkTransformMateOrigin,
  readTransformMateJson,
  transformMateResponse,
} from '@/server/transformmate/http';
export async function POST(request: Request) {
  return transformMateResponse(async () => {
    checkTransformMateOrigin(request);
    await transformMateOwner(request.headers);
    return disconnectTransformMate(
      request.headers,
      await readTransformMateJson(request),
    );
  });
}
