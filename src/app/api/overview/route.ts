import { withApiErrors } from '@/server/auth/api-response';
import { getOverview, OverviewError } from '@/server/overview';
async function GETHandler(request: Request) {
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

export const GET = withApiErrors(GETHandler);
