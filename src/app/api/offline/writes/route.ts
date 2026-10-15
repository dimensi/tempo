import {
  readOfflineWrites,
  saveOfflineWrite,
  offlineWriteResponse,
} from '@/server/offline/writes';
export async function GET(request: Request) {
  return offlineWriteResponse(() => readOfflineWrites(request.headers));
}
export async function POST(request: Request) {
  return offlineWriteResponse(() => saveOfflineWrite(request));
}
