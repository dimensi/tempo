import 'server-only';
import {
  FirebaseRefreshError,
  TransformMateApiError,
  TransformMateResponseError,
} from '@/server/transformmate/errors';
import { z } from 'zod';
import {
  transformMateTrainingsSchema,
  transformMateTrainingDetailSchema,
} from '@/server/transformmate/schemas';
import { createSecretRedactor } from '@/server/transformmate/redaction';
import type {
  TransformMateTokenProvider,
  RawResponse,
} from '@/server/transformmate/types';

export function createTransformMateClient(options: {
  baseUrl: string;
  tokenProvider: TransformMateTokenProvider;
  fetch?: typeof fetch;
}) {
  let base: URL;
  try {
    base = new URL(`${options.baseUrl.replace(/\/+$/, '')}/`);
    if (
      !['https:', 'http:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('Invalid TransformMate base URL');
  }
  const requestFetch = options.fetch ?? fetch;
  const redactor = createSecretRedactor();
  const redact = (value: string) =>
    redactor.text(options.tokenProvider.redact?.(value) ?? value);

  async function get(path: string): Promise<RawResponse> {
    let idToken = await getToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!idToken.trim() || /\s/.test(idToken))
        throw new Error('Invalid Firebase ID token');
      redactor.add(idToken);
      const raw = await request(path, idToken);
      if (raw.status === 401 && attempt === 0) {
        idToken = await getToken(true);
        continue;
      }
      if (raw.status < 200 || raw.status >= 300)
        throw new TransformMateApiError(raw);
      return raw;
    }
    throw new Error('TransformMate retry exhausted');
  }

  async function getToken(forceRefresh = false): Promise<string> {
    try {
      return await (forceRefresh
        ? options.tokenProvider.getIdToken({ forceRefresh: true })
        : options.tokenProvider.getIdToken());
    } catch (error) {
      if (error instanceof FirebaseRefreshError) throw error;
      throw new Error('TransformMate token acquisition failed');
    }
  }

  async function request(path: string, idToken: string): Promise<RawResponse> {
    try {
      const response = await requestFetch(new URL(path, base), {
        method: 'GET',
        headers: { Authorization: `JWT ${idToken}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body: unknown = redact(text);
      let isJson = false;
      try {
        // Normalize escaped JSON strings before redacting values and keys.
        body = redactor.body(
          JSON.parse(redact(JSON.stringify(JSON.parse(text)))),
        ) as unknown;
        isJson = true;
      } catch {
        // Preserve non-JSON and malformed JSON as text for local inspection.
      }
      const raw: RawResponse = {
        status: response.status,
        statusText: redact(response.statusText),
        contentType: redact(response.headers.get('content-type') ?? ''),
        isJson,
        body,
      };
      return raw;
    } catch {
      // Fetch errors can include request details; do not preserve their cause.
      throw new Error('TransformMate request or response read failed');
    }
  }

  async function validated<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<RawResponse<T>> {
    const response = await get(path);
    const parsed = schema.safeParse(response.body);
    if (!response.isJson || !parsed.success) {
      // Do not expose payload values or validation issues in errors.
      throw new TransformMateResponseError(path, response.status);
    }
    return { ...response, body: parsed.data };
  }
  function detailPath(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error('Invalid TransformMate training ID');
    return `workouts/trainings/${id}/`;
  }

  return {
    getMe: () => get('users/me/'),
    getTrainingsRaw: () => get('workouts/trainings/'),
    getTrainingRaw: (id: number) => get(detailPath(id)),
    getTrainings: () =>
      validated('workouts/trainings/', transformMateTrainingsSchema),
    getTraining: (id: number) =>
      validated(detailPath(id), transformMateTrainingDetailSchema),
  };
}
