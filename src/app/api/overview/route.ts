import { getOverview, OverviewError } from '@/server/overview';
export async function GET(request: Request) {
  try {
    const data = await getOverview(
      request.headers,
      new URL(request.url).searchParams.get('timezone'),
    );
    return Response.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'Overview unavailable' },
      {
        status: error instanceof OverviewError ? error.status : 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
