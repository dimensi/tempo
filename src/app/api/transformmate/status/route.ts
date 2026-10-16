import { withApiErrors } from '@/server/auth/api-response';
import { getTransformMateStatus } from '@/server/transformmate/connection';
import { transformMateResponse } from '@/server/transformmate/http';
export const dynamic = 'force-dynamic';
async function GETHandler(request: Request) {
  return transformMateResponse(() => getTransformMateStatus(request.headers));
}

export const GET = withApiErrors(GETHandler);
