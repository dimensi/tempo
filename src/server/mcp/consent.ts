import 'server-only';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { getAuth } from '@/server/auth';
import { mcpResource } from '@/server/auth/mcp-oauth';
import { z } from 'zod';
import { mcpScopes } from '@/contracts/mcp-scopes';

export async function completeMcpConsent(
  headers: Headers,
  query: string,
  accept: boolean,
) {
  if (!(await validMcpQuery(query))) throw new Error('Invalid consent');
  const session = await getAuth().api.getSession({ headers });
  if (session?.user.role !== 'OWNER') throw new Error('Owner required');
  const oauthHeaders = new Headers(headers);
  oauthHeaders.set('accept', 'application/json');
  oauthHeaders.set('content-type', 'application/json');
  const response = await getAuth().handler(
    new Request(new URL('/api/auth/oauth2/consent', mcpResource()), {
      method: 'POST',
      headers: oauthHeaders,
      body: JSON.stringify({ accept, oauth_query: query }),
    }),
  );
  const target = response.headers.get('location');
  if (target) return z.url().parse(target);
  if (!response.ok) throw new Error('Consent failed');
  return z.object({ url: z.url() }).parse(await response.json()).url;
}

export async function validMcpQuery(query: string) {
  if (query.length > 8192) return false;
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(query, secret))) return false;
  const params = new URLSearchParams(query);
  const scopes = params.get('scope')?.split(' ') ?? [];
  return (
    scopes.includes('tempo:read') &&
    params.getAll('scope').length === 1 &&
    scopes.every((s) => (mcpScopes as readonly string[]).includes(s)) &&
    params.getAll('resource').length === 1 &&
    params.get('resource') === mcpResource()
  );
}
export function consentQuery(
  params: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.append(key, value);
  }
  return query.toString();
}
