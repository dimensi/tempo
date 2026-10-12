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
import { transformMateExerciseDetailSchema } from '@/server/transformmate/exercise-schema';
import { trainingWriteSnapshot } from '@/server/transformmate/write-snapshot';
import {
  addExerciseInputSchema,
  createTrainingInputSchema,
  updateTrainingInputSchema,
  setInputSchema,
  updateSetInputSchema,
  parseWriteInput,
  type CreateTrainingInput,
  type UpdateTrainingInput,
  type AddExerciseInput,
  type SetInput,
  type UpdateSetInput,
  type TrainingWriteBody,
} from '@/server/transformmate/write-inputs';
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

  async function get(
    path: string,
    method = 'GET',
    data?: unknown,
  ): Promise<RawResponse> {
    let idToken = await getToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!idToken.trim() || /\s/.test(idToken))
        throw new Error('Invalid Firebase ID token');
      redactor.add(idToken);
      const raw = await request(path, idToken, method, data);
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

  async function request(
    path: string,
    idToken: string,
    method: string,
    data?: unknown,
  ): Promise<RawResponse> {
    try {
      const response = await requestFetch(new URL(path, base), {
        method,
        headers: {
          Authorization: `JWT ${idToken}`,
          Accept: 'application/json; version=1.3',
          'Accept-Language': 'ru',
          'User-Agent': 'yazio-dashboard (TransformMate integration)',
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
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
    method = 'GET',
    data?: unknown,
  ): Promise<RawResponse<T>> {
    const response = await get(path, method, data);
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

  const mutationResponseSchema = z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  });
  const getTraining = (id: number) =>
    validated(detailPath(id), transformMateTrainingDetailSchema);
  async function mutate(id: number, edit: (body: TrainingWriteBody) => void) {
    const current = await getTraining(id);
    if (current.body.id !== id)
      throw new TransformMateResponseError(detailPath(id), current.status);
    const body = trainingWriteSnapshot(current.body);
    edit(body);
    const input = parseWriteInput(createTrainingInputSchema, body);
    const result = await validated(
      detailPath(id),
      mutationResponseSchema,
      'PATCH',
      input,
    );
    if (result.body.id !== id)
      throw new TransformMateResponseError(detailPath(id), result.status);
    // PATCH uses a reduced response serializer; GET supplies the complete detail.
    return getTraining(id);
  }
  function findExercise(body: TrainingWriteBody, exerciseId: number) {
    const exercise = body.protocols
      .flatMap((protocol) => protocol.workout_exercises)
      .find((item) => item.id === exerciseId);
    if (!exercise)
      throw new Error('TransformMate exercise occurrence not found');
    return exercise;
  }
  function group(
    body: TrainingWriteBody,
    exerciseId: number,
    type: 'plan' | 'fact',
  ) {
    const matches = findExercise(body, exerciseId).metrics.filter(
      (item) => item.type === type,
    );
    if (matches.length !== 1)
      throw new Error('TransformMate metrics group missing or ambiguous');
    return matches[0]!;
  }
  function setAt(
    body: TrainingWriteBody,
    exerciseId: number,
    type: 'plan' | 'fact',
    order: number,
  ) {
    if (!Number.isSafeInteger(order) || order < 1)
      throw new Error('Invalid TransformMate set order');
    const set = group(body, exerciseId, type).sets[order - 1];
    if (!set) throw new Error('TransformMate set not found');
    return set;
  }
  function updateSet(
    id: number,
    exerciseId: number,
    type: 'plan' | 'fact',
    order: number,
    patch: UpdateSetInput,
  ) {
    const input = parseWriteInput(updateSetInputSchema, patch);
    if (type === 'plan' && input.is_done !== undefined)
      throw new Error('is_done belongs to fact sets');
    return mutate(id, (body) =>
      Object.assign(setAt(body, exerciseId, type, order), input),
    );
  }
  return {
    getMe: () => get('users/me/'),
    getTrainingsRaw: () => get('workouts/trainings/'),
    getTrainingRaw: (id: number) => get(detailPath(id)),
    getTrainings: () =>
      validated('workouts/trainings/', transformMateTrainingsSchema),
    listTrainings: () =>
      validated('workouts/trainings/', transformMateTrainingsSchema),
    getTraining,
    getExercise: (id: number) => {
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('Invalid TransformMate exercise ID');
      return validated(`exercises/${id}/`, transformMateExerciseDetailSchema);
    },
    createTraining: (input: CreateTrainingInput) =>
      validated(
        'workouts/trainings/',
        mutationResponseSchema,
        'POST',
        parseWriteInput(createTrainingInputSchema, input),
      ),
    updateTraining: (id: number, patch: UpdateTrainingInput) => {
      const input = parseWriteInput(updateTrainingInputSchema, patch);
      return mutate(id, (body) => Object.assign(body, input));
    },
    deleteTraining: async (id: number) => {
      const detail = await getTraining(id);
      if (detail.body.id !== id || !detail.body.is_mine)
        throw new Error('TransformMate training is not owned by current user');
      return get(detailPath(id), 'DELETE');
    },
    addExercise: (id: number, input: AddExerciseInput) => {
      const { protocolId, ...exercise } = parseWriteInput(
        addExerciseInputSchema,
        input,
      );
      return mutate(id, (body) => {
        const item = {
          ...exercise,
          metrics: [
            { type: 'plan' as const, sets: [] },
            { type: 'fact' as const, sets: [] },
          ],
        };
        if (protocolId === undefined)
          body.protocols.push({ workout_exercises: [item] });
        else {
          const protocol = body.protocols.find(
            (item) => item.id === protocolId,
          );
          if (!protocol) throw new Error('TransformMate protocol not found');
          protocol.workout_exercises.push(item);
        }
      });
    },
    removeExercise: (id: number, exerciseId: number) =>
      mutate(id, (body) => {
        findExercise(body, exerciseId);
        body.protocols = body.protocols
          .map((protocol) => ({
            ...protocol,
            workout_exercises: protocol.workout_exercises.filter(
              (item) => item.id !== exerciseId,
            ),
          }))
          .filter((protocol) => protocol.workout_exercises.length > 0);
      }),
    reorderProtocols: (id: number, protocolIds: number[]) =>
      mutate(id, (body) => {
        if (
          protocolIds.length !== body.protocols.length ||
          new Set(protocolIds).size !== protocolIds.length
        )
          throw new Error('Invalid TransformMate protocol order');
        body.protocols = protocolIds.map((protocolId) => {
          const item = body.protocols.find(
            (protocol) => protocol.id === protocolId,
          );
          if (!item) throw new Error('Invalid TransformMate protocol order');
          return item;
        });
      }),
    reorderExercises: (id: number, protocolId: number, exerciseIds: number[]) =>
      mutate(id, (body) => {
        const protocol = body.protocols.find((item) => item.id === protocolId);
        if (
          !protocol ||
          exerciseIds.length !== protocol.workout_exercises.length ||
          new Set(exerciseIds).size !== exerciseIds.length
        )
          throw new Error('Invalid TransformMate exercise order');
        protocol.workout_exercises = exerciseIds.map((exerciseId) => {
          const item = protocol.workout_exercises.find(
            (exercise) => exercise.id === exerciseId,
          );
          if (!item) throw new Error('Invalid TransformMate exercise order');
          return item;
        });
      }),
    updateExerciseComment: (
      id: number,
      exerciseId: number,
      comment: string,
    ) => {
      const input = parseWriteInput(z.string(), comment);
      return mutate(id, (body) => {
        findExercise(body, exerciseId).comment = input;
      });
    },
    createPlanSet: (
      id: number,
      exerciseId: number,
      input: Omit<SetInput, 'id' | 'is_done'>,
    ) => {
      const set = parseWriteInput(
        setInputSchema.omit({ id: true, is_done: true }),
        input,
      );
      return mutate(id, (body) => {
        if (
          group(body, exerciseId, 'plan').sets.length !==
          group(body, exerciseId, 'fact').sets.length
        )
          throw new Error('TransformMate plan/fact arrays are not aligned');
        group(body, exerciseId, 'plan').sets.push(set);
        // The server does not create fact counterparts. Keep both arrays aligned explicitly.
        group(body, exerciseId, 'fact').sets.push({
          is_done: false,
          techniques: [],
          set_metrics: [],
        });
      });
    },
    updatePlanSet: (
      id: number,
      exerciseId: number,
      order: number,
      patch: UpdateSetInput,
    ) => updateSet(id, exerciseId, 'plan', order, patch),
    deletePlanSet: (id: number, exerciseId: number, order: number) =>
      mutate(id, (body) => {
        setAt(body, exerciseId, 'plan', order);
        if (
          group(body, exerciseId, 'plan').sets.length !==
          group(body, exerciseId, 'fact').sets.length
        )
          throw new Error('TransformMate plan/fact arrays are not aligned');
        group(body, exerciseId, 'plan').sets.splice(order - 1, 1);
        group(body, exerciseId, 'fact').sets.splice(order - 1, 1);
      }),
    updateFactSet: (
      id: number,
      exerciseId: number,
      order: number,
      patch: UpdateSetInput,
    ) => updateSet(id, exerciseId, 'fact', order, patch),
    markSetDone: (id: number, exerciseId: number, order: number, done = true) =>
      updateSet(id, exerciseId, 'fact', order, { is_done: done }),
    startTraining: (id: number, at = new Date().toISOString()) => {
      const started = parseWriteInput(z.iso.datetime({ offset: true }), at);
      return mutate(id, (body) => {
        body.started = started;
      });
    },
    finishTraining: (id: number, at = new Date().toISOString()) => {
      const finished = parseWriteInput(z.iso.datetime({ offset: true }), at);
      return mutate(id, (body) => {
        body.finished = finished;
      });
    },
  };
}

export type TransformMateClient = ReturnType<typeof createTransformMateClient>;
