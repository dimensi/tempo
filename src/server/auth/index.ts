import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDatabase } from '../db';
import { readServerEnv } from '../env';
import * as schema from '../db/schema';
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  const env = readServerEnv();
  return betterAuth({
    database: drizzleAdapter(getDatabase().db, { provider: 'sqlite', schema }),
    baseURL: env.BETTER_AUTH_URL,
    secret:
      env.BETTER_AUTH_SECRET ??
      'development-only-secret-change-before-deploy-32',
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
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
