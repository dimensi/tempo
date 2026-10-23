import 'server-only';
import { passwordLimits } from '@/contracts/password';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDatabase } from '../db';
import { readServerEnv } from '../env';
import * as schema from '../db/schema';
import * as oauthSchema from '../db/schema/oauth';
import { oauthProvider } from '@better-auth/oauth-provider';
import { mcpOAuthOptions, mcpTokenVerifier } from './mcp-oauth';
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  const env = readServerEnv();
  const oauth = mcpOAuthOptions();
  return betterAuth({
    database: drizzleAdapter(getDatabase().db, {
      provider: 'sqlite',
      schema: { ...schema, ...oauthSchema },
    }),
    plugins: [oauthProvider(oauth), mcpTokenVerifier(oauth)],
    baseURL: env.BETTER_AUTH_URL,
    secret:
      env.BETTER_AUTH_SECRET ??
      'development-only-secret-change-before-deploy-32',
    trustedOrigins: [env.BETTER_AUTH_URL, 'https://*.dimensi.ru'],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: passwordLimits.min,
      maxPasswordLength: passwordLimits.max,
    },
    user: {
      additionalFields: {
        role: {
          type: ['OWNER', 'TRAINER'],
          defaultValue: 'TRAINER',
          required: true,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://') },
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 30 },
  });
}
export function getAuth() {
  return (instance ??= createAuth());
}
