import 'server-only';
import { getAuth } from '@/server/auth';

type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>;
export type McpPrincipal = {
  user: Session['user'];
  session: null;
  scopes: string[];
  allowedScopes: string[];
  clientId: string;
};
// Object identity, never a client-provided header, carries the verified MCP scope.
const principals = new WeakMap<Headers, () => Promise<McpPrincipal>>();
export function bindMcpPrincipal(
  headers: Headers,
  read: () => Promise<McpPrincipal>,
) {
  principals.set(headers, read);
}
export function isMcpPrincipal(headers: Headers) {
  return principals.has(headers);
}
export async function getDataSession(headers: Headers) {
  const read = principals.get(headers);
  return read
    ? read().catch(() => null)
    : getAuth().api.getSession({ headers });
}
