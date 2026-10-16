import { readContext } from '@/server/read-context';
export async function GET(request: Request) {
  try {
    const context = await readContext(request.headers);
    return Response.json(context ?? { error: 'Access denied' }, {
      status: context ? 200 : 403,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number(error.status)
        : 503;
    return Response.json(
      { error: 'Read unavailable' },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
