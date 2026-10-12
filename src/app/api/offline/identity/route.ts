import { offlineIdentity } from '@/server/offline';
import {
  offlineResponseError,
  offlineResponseHeaders,
} from '@/server/offline/errors';
export async function GET(request: Request) {
  try {
    return Response.json(
      await offlineIdentity(request.headers, new URL(request.url)),
      { headers: offlineResponseHeaders },
    );
  } catch (error) {
    return offlineResponseError(error);
  }
}
