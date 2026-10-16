import { withApiErrors } from '@/server/auth/api-response';
import {
  measurementErrorResponse,
  measurementSyncIssues,
} from '@/server/measurements';
async function GETHandler(request: Request) {
  try {
    return Response.json(
      await measurementSyncIssues(
        request.headers,
        new URL(request.url).searchParams.get('ownerId') ?? '',
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return measurementErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);
