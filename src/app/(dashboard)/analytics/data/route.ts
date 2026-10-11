import { getAnalytics, AnalyticsError } from '@/server/analytics';
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const data = await getAnalytics(
      request.headers,
      params.get('ownerId') ?? '',
      { from: params.get('from'), to: params.get('to') },
    );
    return Response.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'Analytics unavailable' },
      {
        status: error instanceof AnalyticsError ? error.status : 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
