import 'server-only';
import { hasTrustedOrigin } from '@/server/auth/origin';
export class CollaborationError extends Error {
  constructor(public status: number) {
    super('Collaboration request rejected');
  }
}
export async function respond(action: () => Promise<unknown>) {
  try {
    return Response.json(await action(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof CollaborationError)
      return Response.json(
        { error: error.status === 401 ? 'unauthorized' : 'request_rejected' },
        { status: error.status },
      );
    return Response.json({ error: 'request_failed' }, { status: 500 });
  }
}
export async function jsonBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin');
  if (origin && !hasTrustedOrigin(request)) throw new CollaborationError(403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new CollaborationError(415);
  try {
    return await request.json();
  } catch {
    throw new CollaborationError(400);
  }
}
