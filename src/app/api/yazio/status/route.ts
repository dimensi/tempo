import { withApiErrors } from '@/server/auth/api-response';
import { json, respond } from '@/server/nutrition/http';
import { getYazioStatus } from '@/server/yazio/settings';
export const dynamic = 'force-dynamic';
async function GETHandler(request: Request) {
  return respond(async () => json(await getYazioStatus(request.headers)));
}

export const GET = withApiErrors(GETHandler);
