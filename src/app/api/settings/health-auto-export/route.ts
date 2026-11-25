import { getAuth } from '@/server/auth';
import { withApiErrors } from '@/server/auth/api-response';
import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import {
  healthAutoExportEndpoint,
  issueHealthAutoExportToken,
  readHealthAutoExportStatus,
  revokeHealthAutoExportToken,
} from '@/server/health-auto-export/repository';

export const runtime = 'nodejs';
const responseHeaders = { 'Cache-Control': 'private, no-store' };

function handler(method: 'GET' | 'POST' | 'DELETE') {
  return withApiErrors(async (request: Request) => {
    const failure = (
      status: number,
      error = 'HEALTH_AUTO_EXPORT_SETTINGS_UNAVAILABLE',
    ) => Response.json({ error }, { status, headers: responseHeaders });
    try {
      if (
        method !== 'GET' &&
        request.headers.get('origin') !==
          new URL(readServerEnv().BETTER_AUTH_URL).origin
      )
        return failure(403);
      if (new URL(request.url).search) return failure(400);
      const session = await getAuth().api.getSession({
        headers: request.headers,
      });
      if (!session) return failure(401);
      const ownerId = session.user.id;
      const access = await authorize(
        request.headers,
        'settings:manage',
        ownerId,
      );
      if (!access.ok) return failure(access.status);
      if (access.session.user.role !== 'OWNER') return failure(403);

      if (method === 'POST') {
        if (!healthAutoExportEndpoint())
          return failure(409, 'INSECURE_ENDPOINT');
        const token = issueHealthAutoExportToken(ownerId);
        return Response.json(
          { token, status: readHealthAutoExportStatus(ownerId) },
          { headers: responseHeaders },
        );
      }
      if (method === 'DELETE') revokeHealthAutoExportToken(ownerId);
      return Response.json(readHealthAutoExportStatus(ownerId), {
        headers: responseHeaders,
      });
    } catch {
      return failure(500);
    }
  });
}

export const GET = handler('GET');
export const POST = handler('POST');
export const DELETE = handler('DELETE');
