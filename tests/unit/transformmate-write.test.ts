import { describe, expect, it, vi } from 'vitest';
import type { TrainingWriteBody } from '@/server/transformmate/write-inputs';
import { createTransformMateClient } from '@/server/transformmate/client';
import { trainingDetailFixture } from '../fixtures/transformmate';
import { trainingWriteSnapshot } from '@/server/transformmate/write-snapshot';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';

vi.mock('server-only', () => ({}));
const baseUrl = 'https://example.test/ipt/api/v1';
const token = 'private-id-token';
const refreshed = 'private-new-token';
const credential = 'private-refresh-token';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
type Client = ReturnType<typeof createTransformMateClient>;
const metric = {
  type: 'straight' as const,
  measure: 3,
  metric_values: [{ value: '11' }],
};
const input = {
  name: 'API Probe demo',
  description: 'Demo',
  date: '2026-01-01',
};
const operations: {
  name: string;
  method: string;
  run: (client: Client) => Promise<unknown>;
  check?: (body: TrainingWriteBody) => void;
}[] = [
  {
    name: 'createTraining',
    method: 'POST',
    run: (c) => c.createTraining(input),
    check: (b) => expect(b).toEqual({ ...input, protocols: [] }),
  },
  {
    name: 'updateTraining',
    method: 'PATCH',
    run: (c) => c.updateTraining(101, { name: 'Changed' }),
    check: (b) => expect(b.name).toBe('Changed'),
  },
  {
    name: 'deleteTraining',
    method: 'DELETE',
    run: (c) => c.deleteTraining(101),
  },
  {
    name: 'addExercise',
    method: 'PATCH',
    run: (c) =>
      c.addExercise(101, {
        exercise: 6,
        comment: '',
        exercise_metrics: [3, 4],
      }),
    check: (b) =>
      expect(b.protocols[1]!).toEqual({
        workout_exercises: [
          {
            exercise: 6,
            comment: '',
            exercise_metrics: [3, 4],
            metrics: [
              { type: 'plan', sets: [] },
              { type: 'fact', sets: [] },
            ],
          },
        ],
      }),
  },
  {
    name: 'removeExercise',
    method: 'PATCH',
    run: (c) => c.removeExercise(101, 401),
    check: (b) => expect(b.protocols).toEqual([]),
  },
  {
    name: 'reorderProtocols',
    method: 'PATCH',
    run: (c) => c.reorderProtocols(101, [301]!),
    check: (b) => expect(b.protocols[0]!.id).toBe(301),
  },
  {
    name: 'reorderExercises',
    method: 'PATCH',
    run: (c) => c.reorderExercises(101, 301, [401]!),
    check: (b) => expect(b.protocols[0]!.workout_exercises[0]!.id).toBe(401),
  },
  {
    name: 'updateExerciseComment',
    method: 'PATCH',
    run: (c) => c.updateExerciseComment(101, 401, 'Note'),
    check: (b) =>
      expect(b.protocols[0]!.workout_exercises[0]!.comment).toBe('Note'),
  },
  {
    name: 'createPlanSet',
    method: 'PATCH',
    run: (c) =>
      c.createPlanSet(101, 401, { techniques: [], set_metrics: [metric] }),
    check: (b) => {
      const groups = b.protocols[0]!.workout_exercises[0]!.metrics;
      expect(groups[0]!.sets[1]!).toEqual({
        techniques: [],
        set_metrics: [metric],
      });
      expect(groups[1]!.sets[1]!).toEqual({
        techniques: [],
        set_metrics: [],
        is_done: false,
      });
    },
  },
  {
    name: 'updatePlanSet',
    method: 'PATCH',
    run: (c) => c.updatePlanSet(101, 401, 1, { set_metrics: [metric] }),
    check: (b) =>
      expect(
        b.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!,
      ).toMatchObject({ id: 801, set_metrics: [metric] }),
  },
  {
    name: 'deletePlanSet',
    method: 'PATCH',
    run: (c) => c.deletePlanSet(101, 401, 1),
    check: (b) =>
      expect(
        b.protocols[0]!.workout_exercises[0]!.metrics.map((g) => g.sets),
      ).toEqual([[], []]),
  },
  {
    name: 'updateFactSet',
    method: 'PATCH',
    run: (c) => c.updateFactSet(101, 401, 1, { set_metrics: [metric] }),
    check: (b) =>
      expect(
        b.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!,
      ).toMatchObject({ id: 802, is_done: false, set_metrics: [metric] }),
  },
  {
    name: 'markSetDone',
    method: 'PATCH',
    run: (c) => c.markSetDone(101, 401, 1),
    check: (b) =>
      expect(
        b.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!.is_done,
      ).toBe(true),
  },
  {
    name: 'startTraining',
    method: 'PATCH',
    run: (c) => c.startTraining(101, '2026-01-01T10:00:00Z'),
    check: (b) => expect(b.started).toBe('2026-01-01T10:00:00Z'),
  },
  {
    name: 'finishTraining',
    method: 'PATCH',
    run: (c) => c.finishTraining(101, '2026-01-01T10:30:00Z'),
    check: (b) => expect(b.finished).toBe('2026-01-01T10:30:00Z'),
  },
];
function setup(failure?: number, repeat401 = false) {
  let writes = 0;
  const provider = {
    getIdToken: vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? refreshed : token,
    ),
    redact: (value: string) => value.replaceAll(credential, '[REDACTED]'),
  };
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'GET') return json(trainingDetailFixture());
    writes++;
    if (failure && (failure !== 401 || writes === 1 || repeat401))
      return json(
        {
          detail: `${token} ${refreshed} ${credential}`,
          refresh_token: 'unknown-secret',
        },
        failure,
      );
    return init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : json({ id: 101 }, init?.method === 'POST' ? 201 : 200);
  });
  return {
    client: createTransformMateClient({
      baseUrl,
      tokenProvider: provider,
      fetch: request,
    }),
    provider,
    request,
  };
}

describe.each(operations)('$name', (operation) => {
  it('uses the verified method/path/JWT/body and validates its response', async () => {
    const { client, request } = setup();
    const result = await operation.run(client);
    const write = request.mock.calls.find((call) => call[1]?.method !== 'GET')!;
    expect(String(write[0]!)).toBe(
      `${baseUrl}/workouts/trainings/${operation.method === 'POST' ? '' : '101/'}`,
    );
    expect(write[1]!).toMatchObject({
      method: operation.method,
      headers: { Authorization: `JWT ${token}` },
      cache: 'no-store',
      redirect: 'error',
    });
    if (operation.method === 'DELETE') expect(write[1]?.body).toBeUndefined();
    else {
      expect(write[1]?.headers).toMatchObject({
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(String(write[1]?.body));
      operation.check?.(body);
      if (operation.method === 'PATCH') {
        expect(body).toHaveProperty('description', 'Demo description');
        expect(body).not.toHaveProperty('author');
        expect(body).not.toHaveProperty('progress');
        for (const protocol of body.protocols)
          expect(protocol).not.toHaveProperty('order');
      }
    }
    expect(result).toMatchObject(
      operation.method === 'DELETE'
        ? { status: 204, body: '' }
        : { body: { id: 101 } },
    );
  });
  it('uses the operation-specific 401 policy without replaying creation', async () => {
    const { client, request, provider } = setup(401);
    if (operation.name === 'createTraining') {
      await expect(operation.run(client)).rejects.toMatchObject({
        status: 401,
      });
      expect(
        request.mock.calls.filter((call) => call[1]?.method === 'POST'),
      ).toHaveLength(1);
      expect(
        provider.getIdToken.mock.calls.some((call) => call[0]?.forceRefresh),
      ).toBe(false);
      return;
    }
    await operation.run(client);
    const writes = request.mock.calls.filter(
      (call) => call[1]?.method !== 'GET',
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]?.[1]?.headers).toMatchObject({
      Authorization: `JWT ${refreshed}`,
    });
    expect(writes[0]?.[1]?.body).toEqual(writes[1]?.[1]?.body);
    expect(
      provider.getIdToken.mock.calls.filter((call) => call[0]?.forceRefresh),
    ).toHaveLength(1);
  });
  it('does not exceed the operation-specific 401 attempt limit', async () => {
    const { client, request, provider } = setup(401, true);
    await expect(operation.run(client)).rejects.toMatchObject({ status: 401 });
    expect(
      request.mock.calls.filter((call) => call[1]?.method !== 'GET'),
    ).toHaveLength(operation.name === 'createTraining' ? 1 : 2);
    expect(
      provider.getIdToken.mock.calls.filter((call) => call[0]?.forceRefresh),
    ).toHaveLength(operation.name === 'createTraining' ? 0 : 1);
  });
  it.each([400, 403, 500])(
    'does not retry HTTP %s and redacts error credentials',
    async (status) => {
      const { client, request, provider } = setup(status);
      const error = await operation
        .run(client)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ name: 'TransformMateApiError', status });
      for (const secret of [token, credential, 'unknown-secret'])
        expect(JSON.stringify(error)).not.toContain(secret);
      expect(
        provider.getIdToken.mock.calls.some((call) => call[0]?.forceRefresh),
      ).toBe(false);
      expect(
        request.mock.calls.filter((call) => call[1]?.method !== 'GET'),
      ).toHaveLength(1);
    },
  );
});

describe('write safeguards', () => {
  it('validates the observed historical best result without treating it as current fact', () => {
    const detail = trainingDetailFixture(true);
    const previous = {
      type: 'straight',
      measure: { id: 3 },
      metric_values: [{ id: 901, value: '10' }],
    };
    const parsed = transformMateTrainingDetailSchema.parse({
      ...detail,
      protocols: [
        {
          ...detail.protocols[0]!,
          workout_exercises: [
            {
              ...detail.protocols[0]!.workout_exercises[0]!,
              best_result: { set_metrics: [previous] },
            },
          ],
        },
      ],
    });
    expect(
      parsed.protocols[0]!.workout_exercises[0]!.best_result.set_metrics,
    ).toEqual([previous]);
    expect(
      trainingWriteSnapshot(parsed).protocols[0]!.workout_exercises[0],
    ).not.toHaveProperty('best_result');
  });
  it('does not send unknown response fields as write DTOs', () => {
    const detail = transformMateTrainingDetailSchema.parse(
      trainingDetailFixture(),
    );
    const body = trainingWriteSnapshot(detail);
    const exercise = body.protocols[0]!.workout_exercises[0]!;
    expect(exercise.exercise).toBe(501);
    expect(exercise.metrics[0]!.sets[0]!.set_metrics[0]!.measure).toBe(3);
    expect(exercise).not.toHaveProperty('best_result');
    expect(exercise).not.toHaveProperty('warmup_metrics');
    expect(exercise.metrics[0]!.sets[0]!).not.toHaveProperty('order');
  });
  it('preserves references and rejects unsupported metric types before PATCH', () => {
    const detail = transformMateTrainingDetailSchema.parse(
      trainingDetailFixture(),
    );
    detail.protocols[0]!.workout_exercises[0]!.target_indication = {
      id: 9,
      name: 'Demo',
    };
    detail.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.techniques =
      [{ id: 8 }];
    expect(
      trainingWriteSnapshot(detail).protocols[0]!.workout_exercises[0]!,
    ).toMatchObject({
      target_indication: 9,
      metrics: [{ sets: [{ techniques: [8]! }] }, { type: 'fact' }],
    });
    detail.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.set_metrics[0]!.type =
      'unknown';
    expect(() => trainingWriteSnapshot(detail)).toThrow(
      'Invalid TransformMate write input',
    );
  });
  it('rejects invalid DTOs before contacting the upstream', async () => {
    const { client, request } = setup();
    expect(() =>
      client.updateTraining(101, {
        name: token,
        protocols: [{ order: 1 } as never],
      }),
    ).toThrow('Invalid TransformMate write input');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects missing occurrences, malformed ordering and invalid set selectors without writes', async () => {
    const { client, request } = setup();
    await expect(client.removeExercise(101, 999)).rejects.toThrow('not found');
    await expect(client.reorderExercises(101, 301, [401, 401])).rejects.toThrow(
      'Invalid',
    );
    await expect(client.updateFactSet(101, 401, 0, {})).rejects.toThrow(
      'Invalid',
    );
    expect(request.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(
      true,
    );
  });
  it('rejects writes against a training owned by another user', async () => {
    const detail = { ...trainingDetailFixture(), is_mine: false };
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json(detail));
    const client = createTransformMateClient({
      baseUrl,
      tokenProvider: { getIdToken: async () => token },
      fetch: request,
    });
    await expect(
      client.updateTraining(101, { name: 'Changed' }),
    ).rejects.toThrow('not owned');
    await expect(client.deleteTraining(101)).rejects.toThrow('not owned');
    expect(request.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(
      true,
    );
  });
  it('uses the fresh set ID while addressing the set by its position', async () => {
    const detail = trainingDetailFixture();
    detail.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!.id = 999;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        json(init?.method === 'GET' ? detail : { id: 101 }),
      );
    const client = createTransformMateClient({
      baseUrl,
      tokenProvider: { getIdToken: async () => token },
      fetch: request,
    });
    await client.updateFactSet(101, 401, 1, { set_metrics: [metric] });
    const body = JSON.parse(String(request.mock.calls[1]![1]?.body));
    expect(body.protocols[0].workout_exercises[0].metrics[1].sets[0].id).toBe(
      999,
    );
  });
  it('rejects unaligned pairs rather than deleting an unrelated fact set', async () => {
    const detail = trainingDetailFixture();
    detail.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets = [];
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json(detail));
    const client = createTransformMateClient({
      baseUrl,
      tokenProvider: { getIdToken: async () => token },
      fetch: request,
    });
    await expect(
      client.createPlanSet(101, 401, { set_metrics: [] }),
    ).rejects.toThrow('not aligned');
    await expect(client.deletePlanSet(101, 401, 1)).rejects.toThrow(
      'not aligned',
    );
    expect(request.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(
      true,
    );
  });
  it('does not retry ambiguous network failures for POST', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(token));
    const client = createTransformMateClient({
      baseUrl,
      tokenProvider: { getIdToken: async () => token },
      fetch: request,
    });
    await expect(client.createTraining(input)).rejects.toThrow(
      'request or response read failed',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete mutation responses without issuing the follow-up GET', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        json(
          init?.method === 'GET' ? trainingDetailFixture() : { id: 'invalid' },
        ),
      );
    const client = createTransformMateClient({
      baseUrl,
      tokenProvider: { getIdToken: async () => token },
      fetch: request,
    });
    await expect(client.updateTraining(101, {})).rejects.toThrow(
      'response contract mismatch',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});
