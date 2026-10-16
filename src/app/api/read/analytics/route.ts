import { analyticsDataSchema } from '@/contracts/read-analytics';
import { AnalyticsError, getAnalytics } from '@/server/analytics';
import { withApiErrors } from '@/server/auth/api-response';
import { readContext } from '@/server/read-context';
async function GETHandler(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context?.ownerId)
      return Response.json(
        { error: 'Access denied' },
        { status: context ? 403 : 401 },
      );
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

export const GET = withApiErrors(GETHandler);
