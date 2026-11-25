import 'server-only';
import type { HealthAutoExportErrorCode } from '@/contracts/health-auto-export';
import {
  HealthAutoExportPayloadError,
  normalizeHealthAutoExport,
} from './normalize';
import {
  authenticateHealthAutoExport,
  healthAutoExportEndpoint,
  recordHealthAutoExportFailure,
  saveHealthAutoExportSamples,
} from './repository';

const bodyLimit = 8 * 1024 * 1024;
const bodyDeadlineMs = 15000;
const errorStatus = {
  invalid_payload: 422,
  json_required: 415,
  payload_too_large: 413,
  body_timeout: 408,
  import_unavailable: 503,
} satisfies Record<HealthAutoExportErrorCode, number>;

class ImportError extends Error {
  constructor(readonly code: HealthAutoExportErrorCode) {
    super(code);
  }
}

function importResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
    },
  });
}

function discardBody(request: Request) {
  if (!request.body?.locked) void request.body?.cancel().catch(() => {});
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type')?.split(';')[0];
  if (type?.trim().toLowerCase() !== 'application/json')
    throw new ImportError('json_required');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > bodyLimit))
    throw new ImportError('payload_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ImportError('invalid_payload');
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, bodyDeadlineMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new ImportError('body_timeout');
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) throw new ImportError('payload_too_large');
      chunks.push(value);
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, size),
      ),
    ) as unknown;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('invalid_payload');
  } finally {
    clearTimeout(deadline);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function unauthorized() {
  return importResponse({ error: 'authorization_required' }, 401);
}

export async function receiveHealthAutoExport(request: Request) {
  try {
    if (!healthAutoExportEndpoint())
      throw new ImportError('import_unavailable');
    if (new URL(request.url).search) throw new ImportError('invalid_payload');
    const credential = authenticateHealthAutoExport(
      request.headers.get('authorization'),
    );
    if (!credential) return unauthorized();

    try {
      const { samples, received, ignored } = normalizeHealthAutoExport(
        await readJson(request),
      );
      const inserted = saveHealthAutoExportSamples(credential, samples);
      if (inserted === null) return unauthorized();
      return importResponse({
        received,
        inserted,
        duplicates: samples.length - inserted,
        ignored,
      });
    } catch (error) {
      const code =
        error instanceof ImportError
          ? error.code
          : error instanceof HealthAutoExportPayloadError
            ? 'invalid_payload'
            : 'import_unavailable';
      if (!recordHealthAutoExportFailure(credential, code))
        return unauthorized();
      return importResponse({ error: code }, errorStatus[code]);
    }
  } catch (error) {
    const code =
      error instanceof ImportError ? error.code : 'import_unavailable';
    return importResponse({ error: code }, errorStatus[code]);
  } finally {
    discardBody(request);
  }
}
