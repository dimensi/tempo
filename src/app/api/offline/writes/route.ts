import { withApiErrors } from '@/server/auth/api-response';
import {
  offlineWriteResponse,
  readOfflineWrites,
  saveOfflineWrite,
} from '@/server/offline/writes';
async function GETHandler(request: Request) {
  return offlineWriteResponse(() => readOfflineWrites(request.headers));
}
async function POSTHandler(request: Request) {
  return offlineWriteResponse(() => saveOfflineWrite(request));
}

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);
