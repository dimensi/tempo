import {
  getWeightHistory,
  healthRangeFromRequest,
  healthErrorResponse,
} from '@/server/health';
export async function GET(request: Request) {
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
