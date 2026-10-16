import { withApiErrors } from '@/server/auth/api-response';
import { readContext } from '@/server/read-context';
import { readSettings } from '@/server/read-settings';
async function GETHandler(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context || context.role !== 'OWNER')
      return Response.json(
        { error: 'Access denied' },
        { status: context ? 403 : 401 },
      );
    return Response.json(await readSettings(request.headers, context.ownerId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number(error.status)
        : 503;
    return Response.json({ error: 'Read unavailable' }, { status });
  }
}

export const GET = withApiErrors(GETHandler);
