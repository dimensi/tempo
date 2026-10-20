import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { getAuth } from '@/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) =>
  oauthProviderAuthServerMetadata(getAuth())(request);
