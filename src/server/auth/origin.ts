import 'server-only';
import { readServerEnv } from '@/server/env';

/** Trust the configured public origin, never the internal URL or forwarded host. */
export function hasTrustedOrigin(request: Request): boolean {
  return (
    request.headers.get('origin') ===
    new URL(readServerEnv().BETTER_AUTH_URL).origin
  );
}
