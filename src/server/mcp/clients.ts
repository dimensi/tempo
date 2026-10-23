import 'server-only';
import { z } from 'zod';
import { and, eq, desc, gte, count } from 'drizzle-orm';
import { getAuth } from '@/server/auth';
import { authorize } from '@/server/auth/guards';
import { getDatabase } from '@/server/db';
import { oauthClient } from '@/server/db/schema/oauth';
import { mcpResource } from '@/server/auth/mcp-oauth';
import {
  mcpClientInput,
  mcpClientCredentials,
  mcpClientRevoke,
} from '@/contracts/mcp-clients';

export class McpClientError extends Error {
  constructor(public readonly status: number) {
    super('MCP client operation unavailable');
  }
}
async function ownerScope(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new McpClientError(401);
  const access = await authorize(headers, 'settings:manage', session.user.id);
  if (!access.ok || session.user.role !== 'OWNER')
    throw new McpClientError(access.ok ? 403 : access.status);
  return session.user.id;
}
export async function listMcpClients(headers: Headers) {
  const ownerId = await ownerScope(headers);
  const clients = getDatabase()
    .db.select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      disabled: oauthClient.disabled,
      scopes: oauthClient.scopes,
      createdAt: oauthClient.createdAt,
    })
    .from(oauthClient)
    .where(eq(oauthClient.userId, ownerId))
    .orderBy(desc(oauthClient.createdAt))
    .limit(100)
    .all();
  return {
    endpoint: mcpResource(),
    clients: clients.map((row) => ({
      clientId: row.clientId,
      name: row.name ?? 'Tempo AI',
      // Better Auth serializes array fields to JSON text before the Drizzle adapter.
      callback:
        z
          .array(z.string())
          .parse(JSON.parse(z.string().parse(row.redirectUris)))[0] ?? '',
      disabled: row.disabled === true,
      scopes: z
        .array(z.string())
        .parse(JSON.parse(z.string().parse(row.scopes))),
      createdAt: row.createdAt?.toISOString() ?? null,
    })),
  };
}
export async function createMcpClient(headers: Headers, input: unknown) {
  const ownerId = await ownerScope(headers);
  const value = mcpClientInput.parse(input);
  const db = getDatabase().db;
  const active = db
    .select({ count: count() })
    .from(oauthClient)
    .where(
      and(eq(oauthClient.userId, ownerId), eq(oauthClient.disabled, false)),
    )
    .get()!.count;
  const recent = db
    .select({ count: count() })
    .from(oauthClient)
    .where(
      and(
        eq(oauthClient.userId, ownerId),
        gte(oauthClient.createdAt, new Date(Date.now() - 86400000)),
      ),
    )
    .get()!.count;
  if (active >= 50 || recent >= 20) throw new McpClientError(429);
  const client = await getAuth().api.createOAuthClient({
    headers,
    body: {
      client_name: value.name,
      redirect_uris: [value.callback],
      scope: [
        'tempo:read',
        'offline_access',
        ...(value.writeWorkouts ? ['tempo:workouts:write'] : []),
        ...(value.writeMeasurements ? ['tempo:measurements:write'] : []),
      ].join(' '),
      token_endpoint_auth_method: 'client_secret_post',
      application_type: 'web',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  return mcpClientCredentials.parse(client);
}
export async function revokeMcpClient(headers: Headers, input: unknown) {
  const ownerId = await ownerScope(headers);
  const { clientId } = mcpClientRevoke.parse(input);
  const result = getDatabase()
    .db.update(oauthClient)
    .set({ disabled: true, updatedAt: new Date() })
    .where(
      and(eq(oauthClient.clientId, clientId), eq(oauthClient.userId, ownerId)),
    )
    .run();
  if (!result.changes) throw new McpClientError(404);
  return { ok: true };
}
