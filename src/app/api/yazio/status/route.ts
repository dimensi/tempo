import { getYazioStatus } from '@/server/yazio/settings';
import { json, respond } from '@/server/nutrition/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return respond(async () => json(await getYazioStatus(request.headers)));
}
