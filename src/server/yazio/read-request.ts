import 'server-only';
import { yazioRequest, YazioRequestTimeoutError } from '@/server/yazio/client';
import {
  readDiagnostic,
  YazioReadFailure,
} from '@/server/yazio/sync-diagnostics';

type ReadContext = {
  operation:
    'items' | 'summary' | 'photos' | 'product' | 'recipe' | 'weight' | 'body';
  date?: string;
};

// Call only around idempotent upstream reads, AFTER authentication. No auth/write retries.
export async function retryYazioRead<T>(
  operation: () => Promise<T>,
  context: ReadContext,
  assertCurrent: () => void | Promise<void>,
) {
  const started = Date.now();
  const deadline = started + 45000;
  for (let attempt = 1; ; attempt++) {
    await assertCurrent();
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new YazioRequestTimeoutError('YAZIO read budget exhausted');
      const result = await yazioRequest(operation, Math.min(30000, remaining));
      await assertCurrent();
      if (attempt > 1)
        console.info('yazio_read_recovered', {
          ...context,
          attempts: attempt,
          durationMs: Date.now() - started,
        });
      return result;
    } catch (error) {
      // Connection/lease invalidation is terminal and must not be masked or retried.
      await assertCurrent();
      const diagnostic = readDiagnostic(error);
      const delayMs = attempt * 500;
      const retry =
        diagnostic.retryable && attempt < 3 && Date.now() + delayMs < deadline;
      console.warn(retry ? 'yazio_read_retry' : 'yazio_read_failed', {
        ...context,
        ...diagnostic,
        attempt,
        maxAttempts: 3,
        durationMs: Date.now() - started,
        ...(retry ? { delayMs } : {}),
      });
      if (!retry) throw new YazioReadFailure(diagnostic, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
