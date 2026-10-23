import 'server-only';
import { readServerEnv } from '@/server/env';

/** Trust the configured origin and HTTPS subdomains, never forwarded headers. */
export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === new URL(readServerEnv().BETTER_AUTH_URL).origin) return true;
  try {
    const url = new URL(origin);
    return (
      origin === url.origin &&
      url.protocol === 'https:' &&
      !url.port &&
      url.hostname.endsWith('.dimensi.ru')
    );
  } catch {
    return false;
  }
}
