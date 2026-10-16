import { readContext } from '@/server/read-context';
import { readSettings } from '@/server/read-settings';
export async function GET(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context || context.role !== 'OWNER')
      return Response.json({ error: 'Access denied' }, { status: 403 });
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
