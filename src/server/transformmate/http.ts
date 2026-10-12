import 'server-only';
import { ZodError } from 'zod';
import { readServerEnv } from '@/server/env';
import { transformMateConnectionMessages as messages } from '@/contracts/transformmate-connection';
import {
  TransformMateConnectionAccessError,
  TransformMateAccountBindingError,
  connectionErrorCode,
} from './connection';
import {
  TransformMateStaleConnectionError,
  TransformMateStorageError,
} from './token-store';
export function transformMateJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export function checkTransformMateOrigin(request: Request) {
  if (
    request.headers.get('origin') !==
    new URL(readServerEnv().BETTER_AUTH_URL).origin
  )
    throw new TransformMateConnectionAccessError(403);
}
export async function readTransformMateJson(request: Request) {
  const limit = 12288;
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await request.body?.cancel();
    throw new SyntaxError('Invalid request');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Invalid request');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SyntaxError('Invalid request');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new SyntaxError('Invalid request');
  }
}
export async function transformMateResponse(operation: () => Promise<unknown>) {
  try {
    return transformMateJson({
      contractVersion: 1,
      source: 'user',
      data: await operation(),
    });
  } catch (error) {
    const status =
      error instanceof TransformMateConnectionAccessError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof TransformMateStaleConnectionError ||
              error instanceof TransformMateAccountBindingError
            ? 409
            : error instanceof TransformMateStorageError
              ? 503
              : 502;
    const errorCode =
      error instanceof TransformMateAccountBindingError
        ? 'account_mismatch'
        : error instanceof TransformMateStaleConnectionError
          ? 'connection_changed'
          : status >= 500
            ? connectionErrorCode(error)
            : null;
    // Never return provider bodies, credential values, or validation issue details.
    return transformMateJson(
      {
        error:
          status === 401 || status === 403
            ? messages.noAccess
            : status === 400
              ? messages.invalid
              : errorCode
                ? messages[errorCode]
                : messages.requestError,
        errorCode,
      },
      status,
    );
  }
}
