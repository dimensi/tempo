import { withApiErrors } from '@/server/auth/api-response';
import {
  getWeightHistory,
  healthErrorResponse,
  healthRangeFromRequest,
} from '@/server/health';
async function GETHandler(request: Request) {
  try {
    return Response.json(
      await getWeightHistory(request.headers, healthRangeFromRequest(request)),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return healthErrorResponse(error);
  }
}

export const GET = withApiErrors(GETHandler);
