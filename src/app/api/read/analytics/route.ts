import { readContext } from '@/server/read-context';
import { getAnalytics, AnalyticsError } from '@/server/analytics';
import { analyticsDataSchema } from '@/contracts/read-analytics';
export async function GET(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context)
      return Response.json({ error: 'Access denied' }, { status: 403 });
    const query = new URL(request.url).searchParams;
    const data = await getAnalytics(
      request.headers,
      context.ownerId,
      {
        from: query.get('from') ?? undefined,
        to: query.get('to') ?? undefined,
      },
      query.get('timezone'),
    );
    return Response.json(analyticsDataSchema.parse(data), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'Read unavailable' },
      { status: error instanceof AnalyticsError ? error.status : 503 },
    );
  }
}
