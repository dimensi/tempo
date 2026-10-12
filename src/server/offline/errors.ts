import 'server-only';
import type { z } from 'zod';
import type { offlineErrorSchema } from '@/contracts/offline';
export class OfflineError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: z.infer<typeof offlineErrorSchema>['error'],
  ) {
    super('Offline read failed');
  }
}
export const offlineResponseHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
};
export function offlineResponseError(error: unknown) {
  const known = error instanceof OfflineError;
  return Response.json(
    { error: known ? error.code : 'OFFLINE_UNAVAILABLE' },
    { status: known ? error.status : 503, headers: offlineResponseHeaders },
  );
}
