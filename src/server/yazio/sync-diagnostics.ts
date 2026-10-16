import 'server-only';
import { YazioRequestTimeoutError } from '@/server/yazio/client';

const networkCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
]);
export type ReadDiagnostic = {
  category:
    | 'NETWORK'
    | 'TIMEOUT'
    | 'HTTP'
    | 'VALIDATION'
    | 'STORAGE'
    | 'READ_OR_PERSIST_FAILED';
  code?: string;
  status?: number;
  retryable: boolean;
  attempts?: number;
};

export class YazioReadFailure extends Error {
  constructor(
    readonly diagnostic: ReadDiagnostic,
    readonly attempts: number,
  ) {
    super('YAZIO request failed');
  }
}

export function readDiagnostic(error: unknown): ReadDiagnostic {
  // Only allowlisted scalar values escape. Never return messages, stacks or payloads.
  for (let depth = 0; depth < 6 && error instanceof Error; depth++) {
    if (error instanceof YazioReadFailure)
      return { ...error.diagnostic, attempts: error.attempts };
    // Promise.race cannot cancel SDK requests: never overlap a timed-out attempt.
    if (error instanceof YazioRequestTimeoutError)
      return {
        category: 'TIMEOUT',
        code: 'REQUEST_DEADLINE',
        retryable: false,
      };
    if (error.name === 'TimeoutError')
      return { category: 'TIMEOUT', code: 'ABORTED_TIMEOUT', retryable: true };
    if ('code' in error && typeof error.code === 'string') {
      if (networkCodes.has(error.code))
        return { category: 'NETWORK', code: error.code, retryable: true };
      if (
        [
          'SQLITE_BUSY',
          'SQLITE_FULL',
          'SQLITE_IOERR',
          'ENOSPC',
          'EACCES',
        ].includes(error.code)
      )
        return { category: 'STORAGE', code: error.code, retryable: false };
    }
    if (error.name === 'ZodError' || error instanceof SyntaxError)
      return { category: 'VALIDATION', retryable: false };
    // The pinned SDK encodes HTTP status in this suffix; never log its URL/message.
    const http = /^Error fetching `[^`]*`\. \((\d{3}) [^)]*\)$/.exec(
      error.message,
    );
    if (http)
      return { category: 'HTTP', status: Number(http[1]), retryable: false };
    error = error.cause;
  }
  return { category: 'READ_OR_PERSIST_FAILED', retryable: false };
}

// Never log upstream messages, payloads, URLs, credentials or owner identifiers.
export function syncReadFailure(
  stage: string,
  date: string,
  started: number,
  error: unknown,
) {
  console.warn('yazio_sync_failure', {
    stage,
    date,
    durationMs: Date.now() - started,
    ...readDiagnostic(error),
    ...(error instanceof YazioReadFailure ? { attempts: error.attempts } : {}),
  });
}
