import {
  measurementSyncIssues,
  measurementErrorResponse,
} from '@/server/measurements';
export async function GET(request: Request) {
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
