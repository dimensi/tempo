import { offlineAnamnesis } from '@/server/offline/anamnesis';
import {
  offlineResponseError,
  offlineResponseHeaders,
} from '@/server/offline/errors';
export async function GET(request: Request) {
  try {
    return Response.json(await offlineAnamnesis(request.headers), {
      headers: offlineResponseHeaders,
    });
  } catch (error) {
    return offlineResponseError(error);
  }
}
