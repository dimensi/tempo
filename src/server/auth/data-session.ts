import 'server-only';
import { getAuth } from '@/server/auth';

type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>;
export type McpPrincipal = { user: Session['user']; session: null };
// Object identity, never a client-provided header, carries the verified MCP scope.
const readers = new WeakMap<Headers, () => Promise<McpPrincipal>>();
export function bindMcpReader(
  headers: Headers,
  read: () => Promise<McpPrincipal>,
) {
  readers.set(headers, read);
}
export function isMcpReader(headers: Headers) {
  return readers.has(headers);
}
export async function getDataSession(headers: Headers) {
  const read = readers.get(headers);
  return read
    ? read().catch(() => null)
    : getAuth().api.getSession({ headers });
}
