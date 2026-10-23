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
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import { oauthAccessToken, oauthRefreshToken } from '@/server/db/schema/oauth';
import { readServerEnv } from '@/server/env';
import { mcpScopes } from '@/contracts/mcp-scopes';

export function mcpResource() {
  return new URL('/api/mcp', readServerEnv().BETTER_AUTH_URL).href;
}
function ownerOnly({ user }: { user?: Record<string, unknown> | null }) {
  if (user?.role !== 'OWNER') throw new APIError('FORBIDDEN');
  return {};
}
// The provider requires a finite TTL. This is a practically permanent personal grant.
export const mcpRefreshTokenLifetime = 100 * 365 * 24 * 60 * 60;
export function mcpOAuthOptions(): OAuthOptions<string[]> {
  return {
    loginPage: '/mcp/login',
    consentPage: '/mcp/consent',
    scopes: [...mcpScopes],
    resourceSeedMode: 'merge',
    resources: [
      {
        identifier: mcpResource(),
        name: 'Tempo',
        allowedScopes: [...mcpScopes],
      },
    ],
    grantTypes: ['authorization_code', 'refresh_token'],
    disableJwtPlugin: true,
    storeTokens: 'hashed',
    accessTokenExpiresIn: 900,
    refreshTokenExpiresIn: mcpRefreshTokenLifetime,
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
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === '/oauth2/token',
          handler: createAuthMiddleware(async (ctx) => {
            const response = z
              .object({
                access_token: z.string().min(1).max(2048),
                refresh_token: z.string().min(1).max(2048).optional(),
              })
              .safeParse(ctx.context.returned);
            if (!response.success || !response.data.refresh_token) return;
            const provider = getOAuthProviderApi(ctx, options);
            const accessHash = await provider.hashToken(
              response.data.access_token,
              'access_token',
            );
            const refreshHash = await provider.hashToken(
              response.data.refresh_token,
              'refresh_token',
            );
            // offline_access belongs to the consented client, not the browser login.
            // Detach before returning credentials; the provider still validates and rotates them.
            const { db, sqlite } = getDatabase();
            sqlite.transaction(() => {
              db.update(oauthAccessToken)
                .set({ sessionId: null })
                .where(eq(oauthAccessToken.token, accessHash))
                .run();
              db.update(oauthRefreshToken)
                .set({ sessionId: null })
                .where(eq(oauthRefreshToken.token, refreshHash))
                .run();
            })();
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
          const owner = getDatabase()
            .db.select()
            .from(user)
            .where(eq(user.id, claims.sub))
            .get();
          if (!owner || owner.role !== 'OWNER')
            throw new APIError('UNAUTHORIZED');
          if (typeof claims.client_id !== 'string')
            throw new APIError('UNAUTHORIZED');
          return {
            user: owner,
            session: null,
            scopes: claims.scope.split(' '),
            clientId: claims.client_id,
          };
        },
      ),
    },
  };
}
