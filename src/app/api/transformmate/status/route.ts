import { getTransformMateStatus } from '@/server/transformmate/connection';
import { transformMateResponse } from '@/server/transformmate/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return transformMateResponse(() => getTransformMateStatus(request.headers));
}
