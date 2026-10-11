import { describe, expect, it, vi } from 'vitest';
import { createTransformMateClient } from '@/server/transformmate/client';
import { TransformMateResponseError } from '@/server/transformmate/errors';
import {
  transformMateTrainingDetailSchema,
  transformMateTrainingsSchema,
} from '@/server/transformmate/schemas';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';

vi.mock('server-only', () => ({}));
const makeClient = (body: unknown, contentType = 'application/json') => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        contentType === 'application/json'
          ? JSON.stringify(body)
          : String(body),
        { status: 200, headers: { 'content-type': contentType } },
      ),
    );
  return {
    request,
    client: createTransformMateClient({
      baseUrl: 'https://example.test/ipt/api/v1',
      tokenProvider: { getIdToken: async () => 'synthetic-secret-token' },
      fetch: request,
    }),
  };
};

describe('TransformMate confirmed response contracts', () => {
  it('accepts empty and populated list responses without guessing pagination', () => {
    expect(transformMateTrainingsSchema.parse([])).toEqual([]);
    expect(
      transformMateTrainingsSchema.parse([trainingSummaryFixture()]),
    ).toHaveLength(1);
    expect(
      transformMateTrainingsSchema.safeParse({
        count: 1,
        results: [trainingSummaryFixture()],
      }).success,
    ).toBe(false);
  });
  it.each([false, true])(
    'preserves idle/completed detail, strings and reduced last_results (%s)',
    (completed) => {
      const fixture = trainingDetailFixture(completed);
      const parsed = transformMateTrainingDetailSchema.parse(fixture);
      expect(parsed).toEqual(fixture);
      const exercise = parsed.protocols[0]!.workout_exercises[0]!;
      const fact = exercise.metrics.find((item) => item.type === 'fact')!;
      if (fact.type === 'fact') expect(fact.sets[0]!.is_done).toBe(completed);
      expect(exercise.best_result).toEqual({});
      if (completed) {
        expect(exercise.last_results.sets![0]).not.toHaveProperty('id');
        expect(exercise.last_results.sets![0]).not.toHaveProperty('is_done');
      }
    },
  );
  it('accepts fact values without planned values and unknown metric keys', () => {
    const fixture = trainingDetailFixture(true);
    const metrics = fixture.protocols[0]!.workout_exercises[0]!.metrics;
    metrics[0]!.sets[0]!.set_metrics = [];
    metrics[1]!.sets[0]!.set_metrics[0]!.measure.key = 'future_measure';
    const parsed = transformMateTrainingDetailSchema.parse(fixture);
    expect(
      parsed.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!
        .set_metrics[0]!.measure.key,
    ).toBe('future_measure');
  });
  it('preserves added fields and unknown result metadata without inventing a shape', () => {
    const fixture = trainingDetailFixture(true);
    const parsed = transformMateTrainingDetailSchema.parse({
      ...fixture,
      future_field: { arbitrary: 1 },
      protocols: fixture.protocols.map((protocol) => ({
        ...protocol,
        workout_exercises: protocol.workout_exercises.map((exercise) => ({
          ...exercise,
          best_result: { future: [1] },
        })),
      })),
    });
    expect(parsed.future_field).toEqual({ arbitrary: 1 });
    expect(parsed.protocols[0]!.workout_exercises[0]!.best_result).toEqual({
      future: [1],
    });
  });
  it('does not normalize unstable remote IDs', () => {
    const fixture = trainingDetailFixture(true);
    const changed = structuredClone(fixture);
    changed.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!.id += 100;
    changed.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!.set_metrics[0]!.metric_values[0]!.id += 100;
    expect(transformMateTrainingDetailSchema.parse(changed)).toEqual(changed);
  });
  it('validates typed detail and sends the exact safe detail URL', async () => {
    const fixture = trainingDetailFixture(true);
    const { client, request } = makeClient(fixture);
    expect((await client.getTraining(101)).body).toEqual(fixture);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      'https://example.test/ipt/api/v1/workouts/trainings/101/',
    );
  });
  it('validates typed list while retaining unvalidated raw access', async () => {
    const typed = makeClient([trainingSummaryFixture()]);
    expect((await typed.client.getTrainings()).body[0]?.id).toBe(101);
    const raw = makeClient({ unexpected: true });
    expect((await raw.client.getTrainingsRaw()).body).toEqual({
      unexpected: true,
    });
  });
  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe training ID %s before fetch',
    async (id) => {
      const { client, request } = makeClient({});
      expect(() => client.getTraining(id)).toThrow(
        'Invalid TransformMate training ID',
      );
      expect(() => client.getTrainingRaw(id)).toThrow(
        'Invalid TransformMate training ID',
      );
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('rejects numeric metric values instead of silently coercing them', () => {
    const fixture = trainingDetailFixture(true);
    const values =
      fixture.protocols[0]!.workout_exercises[0]!.metrics[0]!.sets[0]!
        .set_metrics[0]!.metric_values;
    Reflect.set(values[0]!, 'value', 10);
    expect(transformMateTrainingDetailSchema.safeParse(fixture).success).toBe(
      false,
    );
  });
  it('requires is_done on fact sets without requiring it on plan sets', () => {
    const fixture = trainingDetailFixture(true);
    const factSet =
      fixture.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!;
    Reflect.deleteProperty(factSet, 'is_done');
    expect(transformMateTrainingDetailSchema.safeParse(fixture).success).toBe(
      false,
    );
  });
  it.each([{}, { id: 'synthetic-secret-token' }])(
    'sanitizes contract mismatch errors',
    async (payload) => {
      const { client } = makeClient(payload);
      const error = await client
        .getTraining(101)
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(TransformMateResponseError);
      expect(JSON.stringify(error)).not.toContain('synthetic-secret-token');
      expect(error).toMatchObject({
        status: 200,
        endpoint: 'workouts/trainings/101/',
      });
    },
  );
  it('rejects a successful non-JSON response for typed operations', async () => {
    await expect(
      makeClient('not json', 'text/plain').client.getTrainings(),
    ).rejects.toBeInstanceOf(TransformMateResponseError);
  });
});
