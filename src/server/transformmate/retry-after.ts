import 'server-only';

export const MAX_RETRY_AFTER_MS = 60_000;
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number {
  if (!value || value.length > 128) return 5_000;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1_000
    : Date.parse(value) - now;
  return Number.isFinite(delay)
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(1_000, delay))
    : 5_000;
}
