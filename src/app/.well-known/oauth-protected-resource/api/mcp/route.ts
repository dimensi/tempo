import { mcpResource } from '@/server/auth/mcp-oauth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  const resource = mcpResource();
  return Response.json(
    {
      resource,
      authorization_servers: [new URL('/api/auth', resource).href],
      scopes_supported: ['tempo:read', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'Tempo',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
