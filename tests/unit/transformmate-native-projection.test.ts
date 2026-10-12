import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  nativeProjection,
  isNativeTraining,
} from '@/server/workouts/transformmate/native-projection';
import { trainingDetailFixture } from '../fixtures/transformmate';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';

describe('native TransformMate projection', () => {
  it('shows an idle phone training with planned exercises without creating local intent', () => {
    const detail = trainingDetailFixture();
    detail.name = 'x'.repeat(500);
    detail.date = '2026-10-12';
    detail.protocols[0]!.workout_exercises.push({
      ...structuredClone(detail.protocols[0]!.workout_exercises[0]!),
      id: 402,
      order: 2,
    });
    const result = nativeProjection(
      transformMateTrainingDetailSchema.parse(detail),
    );
    expect(result.title).toHaveLength(500);
    expect(result.date).toBe('2026-10-12');
    expect(result.progress).toBe('idle');
    expect(result.exercises).toHaveLength(2);
    expect(result.exercises[0]!.metrics[0]!.sets[0]!.done).toBeNull();
    expect(result).not.toHaveProperty('planId');
    expect(result).not.toHaveProperty('workoutId');
  });
  it('preserves lifecycle, done flags, unsupported metric types, units and literal values', () => {
    const detail = trainingDetailFixture(true);
    const metric =
      detail.protocols[0]!.workout_exercises[0]!.metrics[1]!.sets[0]!
        .set_metrics[0]!;
    metric.type = 'range';
    metric.measure.key = 'duration';
    metric.measure.short_name = 'мин';
    metric.metric_values[0]!.value = '01–03';
    const before = structuredClone(detail);
    const result = nativeProjection(
      transformMateTrainingDetailSchema.parse(detail),
    );
    expect(result.started).toBe(detail.started);
    expect(result.finished).toBe(detail.finished);
    expect(result.progress).toBe('done');
    expect(result.exercises[0]!.metrics[1]!.sets[0]).toMatchObject({
      done: true,
      metrics: [
        { key: 'duration', type: 'range', unit: 'мин', values: ['01–03'] },
        {},
      ],
    });
    expect(detail).toEqual(before);
  });
  it('excludes linked IDs and app markers during ambiguous recovery', () => {
    expect(isNativeTraining({ id: 101, description: '' }, new Set([101]))).toBe(
      false,
    );
    expect(
      isNativeTraining(
        { id: 102, description: 'text [yazio-dashboard:unknown] text' },
        new Set(),
      ),
    ).toBe(false);
    expect(
      isNativeTraining(
        { id: 102, description: 'Phone workout' },
        new Set([101]),
      ),
    ).toBe(true);
  });
});
