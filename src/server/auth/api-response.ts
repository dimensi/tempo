import { getAccessibleOwnerId } from '@/server/access/owner';
import 'server-only';
import { getAuth } from './index';
import { hasTrustedOrigin } from './origin';
/** Classify session-wide failure centrally, without turning an action denial into logout. */
export function withApiErrors<R extends Request, A extends unknown[]>(
  handler: (request: R, ...args: A) => Promise<Response>,
) {
  return async (request: R, ...args: A): Promise<Response> => {
    const response = await handler(request, ...args);
    if (response.status !== 401 && response.status !== 403) return response;
    if (
      response.status === 403 &&
      !['GET', 'HEAD'].includes(request.method) &&
      !hasTrustedOrigin(request)
    )
      return Response.json(
        { error: 'FORBIDDEN' },
        {
          status: 403,
          headers: new Headers([
            ...response.headers,
            ['X-Auth-Error', 'FORBIDDEN'],
          ]),
        },
      );
    const session =
      response.status === 401
        ? null
        : await getAuth().api.getSession({ headers: request.headers });
    const code =
      response.status === 401
        ? 'AUTH_REQUIRED'
        : session?.user.role === 'TRAINER' &&
            !(await getAccessibleOwnerId(request.headers))
          ? 'ACCESS_REVOKED'
          : 'FORBIDDEN';
    return Response.json(
      { error: code },
      // HEAD has no body on the wire; keep the same code available to clients.
      {
        status: response.status,
        headers: new Headers([...response.headers, ['X-Auth-Error', code]]),
      },
    );
  };
}
