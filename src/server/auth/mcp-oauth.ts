import 'server-only';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from 'better-auth/api';
import {
  getOAuthProviderApi,
  type OAuthOptions,
} from '@better-auth/oauth-provider';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { session, user } from '@/server/db/schema';
import { oauthRefreshToken } from '@/server/db/schema/oauth';
import { readServerEnv } from '@/server/env';

export function mcpResource() {
  return new URL('/api/mcp', readServerEnv().BETTER_AUTH_URL).href;
}
function ownerOnly({ user }: { user?: Record<string, unknown> | null }) {
  if (user?.role !== 'OWNER') throw new APIError('FORBIDDEN');
  return {};
}
function ownerSession(sessionId: string, ownerId: string) {
  const row = getDatabase()
    .db.select({ session, user })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(and(eq(session.id, sessionId), eq(user.id, ownerId)))
    .get();
  return row?.user.role === 'OWNER' &&
    row.session.expiresAt.getTime() > Date.now()
    ? row
    : null;
}
export function mcpOAuthOptions(): OAuthOptions<string[]> {
  return {
    loginPage: '/mcp/login',
    consentPage: '/mcp/consent',
    scopes: ['tempo:read', 'offline_access'],
    resources: [
      {
        identifier: mcpResource(),
        name: 'Tempo',
        allowedScopes: ['tempo:read', 'offline_access'],
      },
    ],
    grantTypes: ['authorization_code', 'refresh_token'],
    disableJwtPlugin: true,
    storeTokens: 'hashed',
    accessTokenExpiresIn: 900,
    refreshTokenExpiresIn: 60 * 60 * 24 * 30,
    refreshTokenReuseInterval: 0,
    codeExpiresIn: 300,
    allowDynamicClientRegistration: false,
    clientRegistrationRequirePKCE: true,
    enforcePerClientResources: true,
    clientRegistrationDefaultResources: [mcpResource()],
    clientPrivileges: ({ user }) => user?.role === 'OWNER',
    resourcePrivileges: () => false,
    customAccessTokenClaims: ownerOnly,
    customTokenResponseFields: ownerOnly,
  };
}

// No HTTP path: this capability is callable only by the server-side auth API.
export function mcpTokenVerifier(options: OAuthOptions<string[]>) {
  return {
    id: 'tempo-mcp-verifier',
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string; body?: Record<string, unknown> }) =>
            ctx.path === '/oauth2/token' &&
            ctx.body?.grant_type === 'refresh_token',
          handler: createAuthMiddleware(async (ctx) => {
            const value = z
              .string()
              .min(1)
              .max(2048)
              .safeParse(ctx.body?.refresh_token);
            if (!value.success)
              throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
            const hash = await getOAuthProviderApi(ctx, options).hashToken(
              value.data,
              'refresh_token',
            );
            const row = getDatabase()
              .db.select()
              .from(oauthRefreshToken)
              .where(eq(oauthRefreshToken.token, hash))
              .get();
            // The provider permits session-independent refresh; Tempo deliberately does not.
            if (!row?.sessionId || !ownerSession(row.sessionId, row.userId))
              throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
          }),
        },
      ],
    },
    endpoints: {
      verifyTempoToken: createAuthEndpoint(
        {
          method: 'POST',
          body: z.object({ token: z.string().min(1).max(2048) }),
        },
        async (ctx) => {
          const claims = await getOAuthProviderApi(
            ctx,
            options,
          ).requireActiveAccessToken(ctx.body.token);
          const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
          if (
            claims.iss !== ctx.context.baseURL ||
            !aud.includes(mcpResource()) ||
            claims.cnf ||
            typeof claims.sid !== 'string' ||
            typeof claims.sub !== 'string' ||
            typeof claims.exp !== 'number' ||
            claims.exp <= Date.now() / 1000
          )
            throw new APIError('UNAUTHORIZED');
          if (
            typeof claims.scope !== 'string' ||
            !claims.scope.split(' ').includes('tempo:read')
          )
            throw new APIError('FORBIDDEN', { error: 'insufficient_scope' });
          const row = ownerSession(claims.sid, claims.sub);
          if (!row) throw new APIError('UNAUTHORIZED');
          return row;
        },
      ),
    },
  };
}
