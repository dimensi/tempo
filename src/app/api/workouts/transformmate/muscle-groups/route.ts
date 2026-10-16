import { withApiErrors } from '@/server/auth/api-response';
import {
  catalogResponse,
  muscleDictionary,
} from '@/server/transformmate/catalog';
async function GETHandler(request: Request) {
  return catalogResponse(() =>
    muscleDictionary(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}

export const GET = withApiErrors(GETHandler);
