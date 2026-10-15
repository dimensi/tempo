import 'server-only';

// Never log upstream messages, payloads, URLs, credentials or owner identifiers.
export function syncReadFailure(stage: string, date: string, started: number) {
  console.warn('yazio_sync_failure', {
    stage,
    date,
    durationMs: Date.now() - started,
    category: 'READ_OR_PERSIST_FAILED',
  });
}
