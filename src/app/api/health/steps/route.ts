import {
  getStepsSummary,
  healthRangeFromRequest,
  healthErrorResponse,
} from '@/server/health';
export async function GET(request: Request) {
  try {
    return Response.json(
      await getStepsSummary(request.headers, healthRangeFromRequest(request)),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return healthErrorResponse(error);
  }
}
