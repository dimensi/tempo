import 'server-only';
import { createTransformMateClient } from '@/server/transformmate/client';
import { TransformMateApiError } from '@/server/transformmate/errors';
import type {
  TransformMateTokenProvider,
  RawResponse,
} from '@/server/transformmate/types';

export const TRANSFORMMATE_BASE_URL =
  'https://transformmate.pht.space/ipt/api/v1';

async function capture(
  operation: () => Promise<RawResponse>,
): Promise<RawResponse> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TransformMateApiError) return error;
    throw error;
  }
}

export async function probeTransformMate(options: {
  tokenProvider: TransformMateTokenProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
  log: (message: string) => void;
  raw?: boolean;
  trainingId?: number;
}) {
  const client = createTransformMateClient({
    ...options,
    baseUrl: options.baseUrl ?? TRANSFORMMATE_BASE_URL,
  });
  function print(path: string, response: RawResponse) {
    options.log(`TransformMate ${path}: ${response.status} (JWT)`);
    if (options.raw || response.status >= 400) {
      options.log(`content-type: ${response.contentType || '(absent)'}`);
      options.log(
        response.isJson
          ? JSON.stringify(response.body, null, 2)
          : String(response.body),
      );
    }
  }
  const me = await capture(client.getMe);
  print('/users/me/', me);
  if (me.status < 200 || me.status >= 300)
    return { scheme: 'JWT', me, trainings: null, detail: null };
  const trainings = await capture(client.getTrainings);
  print('/workouts/trainings/', trainings);
  if (trainings.isJson) {
    if (Array.isArray(trainings.body))
      options.log(`trainings: ${trainings.body.length}`);
    else if (trainings.body !== null && typeof trainings.body === 'object') {
      options.log(
        `trainings JSON: object; keys: ${Object.keys(trainings.body).join(', ')}`,
      );
    } else
      options.log(
        `trainings JSON: ${trainings.body === null ? 'null' : typeof trainings.body}`,
      );
  }
  const trainingId = options.trainingId;
  const detail =
    trainingId === undefined ||
    trainings.status < 200 ||
    trainings.status >= 300
      ? null
      : await capture(() => client.getTraining(trainingId));
  if (detail) print(`/workouts/trainings/${options.trainingId}/`, detail);
  return { scheme: 'JWT', me, trainings, detail };
}
