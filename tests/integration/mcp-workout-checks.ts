import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Client } from '@modelcontextprotocol/client';
import {
  mcpOutput,
  mcpWorkoutInput,
  mcpExerciseHistoryInput,
} from '@/contracts/mcp';
import { workoutRepository } from '@/server/workouts/repository';
import { workouts } from '@/server/db/schema/workouts';
import { workoutTransformMateLinks } from '@/server/db/schema/transformmate';
import { workoutTransformMateNative } from '@/server/db/schema/transformmate-native';
import {
  configuredTransformMateStore,
  getTransformMateBindingFence,
} from '@/server/transformmate/runtime';
import { nativeRepository } from '@/server/workouts/transformmate/native-repository';
import { syncStateSchema } from '@/server/workouts/transformmate/state';
import { readMcpWorkout, readMcpExerciseHistory } from '@/server/mcp/workouts';

/** Extends the existing real-OAuth MCP scenario; does not add a test case. */
export async function assertWorkoutTools(
  client: Client,
  connection: ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
  headers: Headers,
  trainerHeaders: Headers,
) {
  const directory = mkdtempSync(join(tmpdir(), 'tempo-mcp-workouts-'));
  const oldTokenFile = process.env.TRANSFORMMATE_TOKEN_FILE;
  process.env.TRANSFORMMATE_TOKEN_FILE = join(
    directory,
    'synthetic-token.json',
  );
  const repo = workoutRepository(connection.db);
  const exercise = (name: string, exerciseId?: number, weightKg = 20) => ({
    name,
    ...(exerciseId === undefined
      ? {}
      : { transformMate: { exerciseId, occurrenceKey: randomUUID() } }),
    sets: [{ reps: 5, weightKg }],
  });
  const plan = repo.create('owner', {
    title: 'History',
    note: '',
    date: '2026-08-01',
    status: 'planned',
    exercises: [
      exercise('Press', 501),
      exercise('Press', 502),
      exercise('Press'),
    ],
  });
  const create = (
    ownerId: string,
    date: string,
    exercises: ReturnType<typeof exercise>[],
    completed = true,
  ) => {
    const saved = repo.create(ownerId, {
      title: 'History',
      note: '',
      date,
      status: 'planned',
      exercises,
    });
    const { id, revision } = saved;
    const data = {
      title: saved.title,
      note: saved.note,
      date: saved.date,
      exercises: saved.exercises,
    };
    const started = repo.update(
      ownerId,
      id,
      revision,
      { ...data, status: 'in_progress' },
      'start',
    );
    if (!completed) return started;
    return repo.update(
      ownerId,
      id,
      started.revision,
      { ...data, status: 'completed' },
      'complete',
    );
  };
  const completed = create('owner', '2026-08-01', [
    exercise('Renamed press', 501, 0),
    exercise('Repeated press', 501, 30),
    exercise('Press', 502, 100),
    exercise('Press', undefined, 400),
  ]);
  const partial = create(
    'owner',
    '2026-08-02',
    [exercise('Different name', 501, 25)],
    false,
  );
  const foreign = create('trainer', '2026-08-01', [
    exercise('Press', 501, 999),
  ]);
  const linkId = connection.db
    .select()
    .from(workoutTransformMateLinks)
    .where(eq(workoutTransformMateLinks.planId, completed.id))
    .get()!.id;
  const state = syncStateSchema.parse({
    version: 1,
    workout: {
      id: completed.id,
      date: plan.date,
      title: plan.title,
      exercises: plan.exercises,
    },
    planTitle: plan.title,
    marker: `[yazio-dashboard:${linkId}]`,
    attempted: true,
    status: 'synced',
    reason: null,
    expected: null,
    baseline: null,
    occurrences: [],
    checkedAt: '2026-08-05T00:00:00Z',
    actual: {
      date: '2026-08-01',
      title: 'History',
      started: null,
      finished: null,
      exercises: [
        {
          occurrenceKey: null,
          exerciseId: 501,
          name: 'Provider press',
          comment: '',
          sets: [{ order: 1, done: false, metrics: [] }],
        },
      ],
    },
  });
  connection.db
    .insert(workoutTransformMateLinks)
    .values({
      id: linkId,
      ownerId: 'owner',
      planId: completed.id,
      workoutId: completed.id,
      remoteTrainingId: 9002,
      state: JSON.stringify(state),
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z',
    })
    .onConflictDoUpdate({
      target: [
        workoutTransformMateLinks.ownerId,
        workoutTransformMateLinks.planId,
        workoutTransformMateLinks.workoutId,
      ],
      set: { state: JSON.stringify(state), remoteTrainingId: 9002 },
    })
    .run();
  const range = { from: '2026-08-01', to: '2026-08-04' };
  const exerciseRef = { source: 'TransformMate', exerciseId: 501 };
  const historyArgs = { ...range, exerciseRef };
  const completedRef = {
    kind: 'workout',
    id: completed.id,
    date: completed.date,
  };
  async function call(name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError).toBeFalsy();
    return mcpOutput.parse(r.structuredContent);
  }
  try {
    const store = configuredTransformMateStore('owner');
    await store.load();
    await store.save({
      connectionId: randomUUID(),
      apiKey: 'synthetic-api-key',
      refreshToken: 'synthetic-refresh',
      userId: 'synthetic-user',
      projectId: 'synthetic-project',
      account: { id: 1, name: null, email: null },
      checkedAt: '2026-08-01T00:00:00Z',
    });
    const binding = await getTransformMateBindingFence('owner');
    if (!binding.accountScope)
      throw new Error('Missing synthetic account scope');
    const metrics = [
      { name: 'Weight', unit: 'kg', type: 'straight', values: ['0'] },
    ];
    const nativeMetrics = metrics.map((m) => ({ key: 'weight', ...m }));
    const snapshot = {
      source: 'transformmate' as const,
      remoteTrainingId: 9001,
      date: '2026-08-04',
      title: 'Native',
      progress: 'finished',
      started: null,
      finished: '2026-08-04T12:00:00Z',
      remoteUpdatedAt: '2026-08-04T12:00:00Z',
      exercises: [101, 102].map((remoteExerciseId) => ({
        protocolId: 1,
        protocolOrder: 1,
        remoteExerciseId,
        exerciseId: 501,
        order: remoteExerciseId,
        name: 'Native press',
        comment: '',
        metrics: [
          {
            type: 'plan' as const,
            sets: [{ order: 1, done: null, metrics: nativeMetrics }],
          },
          {
            type: 'fact' as const,
            sets: [
              { order: 1, done: false, metrics: [] },
              { order: 2, done: false, metrics: nativeMetrics },
            ],
          },
        ],
      })),
    };
    const native = nativeRepository(connection.db);
    native.save(
      'owner',
      binding.accountScope,
      snapshot,
      '2026-08-05T00:00:00Z',
    );
    native.save(
      'owner',
      binding.accountScope,
      { ...snapshot, remoteTrainingId: 9002 },
      '2026-08-05T00:00:00Z',
    );
    const beforeReads = connection.sqlite
      .prepare('select total_changes() as count')
      .get();
    const history = await call('get_exercise_history', historyArgs);
    // Three LOCAL facts + two native occurrences; no planned workouts, foreign, empty linked, or duplicate native copy.
    expect(history.data.records).toHaveLength(5);
    expect(history.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Renamed press',
          reps: 5,
          weightKg: 0,
          executionStatus: 'completed',
        }),
        expect.objectContaining({
          name: 'Different name',
          weightKg: 25,
          executionStatus: 'in_progress',
        }),
        expect.objectContaining({
          source: 'TransformMate',
          order: 2,
          metrics: nativeMetrics,
          executionStatus: 'completed',
        }),
      ]),
    );
    const detail = await call('get_workout', {
      workoutRef: completedRef,
      detail: 'records',
    });
    expect(detail.data).toMatchObject({
      executionStatus: 'completed',
    });
    expect(detail.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'actual',
          historyRef: null,
          weightKg: 400,
        }),
      ]),
    );
    const planRef = {
      kind: 'workout',
      id: plan.id,
      date: '2026-08-01',
    };
    const planDetail = await call('get_workout', { workoutRef: planRef });
    expect(planDetail.data).toMatchObject({
      executionStatus: 'planned',
    });
    const linkedDetail = await call('get_workout', {
      workoutRef: { kind: 'linked', id: linkId, date: '2026-08-01' },
    });
    expect(linkedDetail.data).toMatchObject({ executionStatus: 'not_started' });
    expect(linkedDetail.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'actual',
          setCount: 1,
          recordedSetCount: 0,
        }),
      ]),
    );
    const discovery = await call('get_workouts', {
      ...range,
      detail: 'records',
      limit: 50,
    });
    expect(discovery.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workoutRef: completedRef,
          exercises: expect.arrayContaining([
            expect.objectContaining({
              historyRef: { source: 'TransformMate', exerciseId: 501 },
            }),
            expect.objectContaining({ historyRef: null }),
          ]),
        }),
      ]),
    );
    expect(
      (
        await call('get_exercise_history', {
          ...historyArgs,
          exerciseRef: { ...exerciseRef, exerciseId: 503 },
        })
      ).data.records,
    ).toEqual([]);
    const nativeDetail = await call('get_workout', {
      workoutRef: { kind: 'native', id: 9001, date: '2026-08-04' },
    });
    expect(nativeDetail.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'actual',
          setCount: 2,
          recordedSetCount: 1,
        }),
      ]),
    );
    expect(
      connection.sqlite.prepare('select total_changes() as count').get(),
    ).toEqual(beforeReads);
    const first = await call('get_exercise_history', {
      ...historyArgs,
      limit: 1,
    });
    const second = await call('get_exercise_history', {
      ...historyArgs,
      limit: 1,
      cursor: first.next_cursor,
    });
    expect(second.data.records).not.toEqual(first.data.records);
    const wrongCursor = await client.callTool({
      name: 'get_exercise_history',
      arguments: {
        ...historyArgs,
        exerciseRef: { ...exerciseRef, exerciseId: 502 },
        cursor: first.next_cursor,
      },
    });
    expect(wrongCursor).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'invalid_cursor' }],
    });
    const summary = await call('get_workout', {
      workoutRef: completedRef,
      limit: 1,
    });
    expect(summary.next_cursor).not.toBeNull();
    const summaryNext = await call('get_workout', {
      workoutRef: completedRef,
      limit: 1,
      cursor: summary.next_cursor,
    });
    expect(summaryNext.data.records).not.toEqual(summary.data.records);
    for (const ref of [
      { kind: 'workout', id: foreign.id, date: foreign.date },
      { kind: 'workout', id: randomUUID(), date: foreign.date },
      { kind: 'native', id: 9002, date: '2026-08-04' },
    ])
      expect(
        await client.callTool({
          name: 'get_workout',
          arguments: { workoutRef: ref },
        }),
      ).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'not_found' }],
      });
    await expect(
      readMcpWorkout(
        trainerHeaders,
        'owner',
        mcpWorkoutInput.parse({ workoutRef: completedRef }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readMcpExerciseHistory(
        trainerHeaders,
        'owner',
        mcpExerciseHistoryInput.parse(historyArgs),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readMcpWorkout(
        headers,
        'trainer',
        mcpWorkoutInput.parse({ workoutRef: completedRef }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await call('get_exercise_history', {
          ...historyArgs,
          exerciseRef: { ...exerciseRef, exerciseId: 502 },
        })
      ).data.records,
    ).toHaveLength(1);
    expect(
      (
        await call('get_exercise_history', {
          ...historyArgs,
          from: '2026-01-01',
          to: '2026-12-31',
        })
      ).data.records,
    ).toHaveLength(5);
    expect(
      await client.callTool({
        name: 'get_exercise_history',
        arguments: { ...historyArgs, from: '2025-01-01' },
      }),
    ).toMatchObject({ isError: true });
    // Entered provider zero is an actual partial fact; sources remain separate and overlap is explicit.
    state.actual!.exercises[0]!.sets[0]!.metrics = metrics;
    connection.db
      .update(workoutTransformMateLinks)
      .set({ state: JSON.stringify(state) })
      .where(eq(workoutTransformMateLinks.id, linkId))
      .run();
    const overlap = await call('get_exercise_history', historyArgs);
    expect(overlap.data.coverage).toMatchObject({ possibleOverlaps: true });
    expect(overlap.data.records).toHaveLength(6);
    expect(overlap.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'TransformMate',
          date: '2026-08-01',
          executionStatus: 'in_progress',
          possibleOverlap: true,
          metrics,
        }),
      ]),
    );
    // Dense valid history must fail safely before materializing all output rows.
    native.save(
      'owner',
      binding.accountScope,
      {
        ...snapshot,
        exercises: Array.from({ length: 100 }, (_, index) => ({
          ...snapshot.exercises[0]!,
          remoteExerciseId: index + 1,
          metrics: [
            {
              type: 'fact' as const,
              sets: Array.from({ length: 100 }, (_, order) => ({
                order: order + 1,
                done: true,
                metrics: [],
              })),
            },
          ],
        })),
      },
      '2026-08-05T00:00:00Z',
    );
    expect(
      await client.callTool({
        name: 'get_exercise_history',
        arguments: historyArgs,
      }),
    ).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'narrow_range' }],
    });
  } finally {
    connection.db
      .delete(workoutTransformMateNative)
      .where(inArray(workoutTransformMateNative.remoteTrainingId, [9001, 9002]))
      .run();
    connection.db
      .delete(workoutTransformMateLinks)
      .where(
        inArray(workoutTransformMateLinks.planId, [
          plan.id,
          completed.id,
          partial.id,
          foreign.id,
        ]),
      )
      .run();
    connection.db
      .delete(workouts)
      .where(
        inArray(workouts.id, [completed.id, partial.id, plan.id, foreign.id]),
      )
      .run();
    if (oldTokenFile === undefined) delete process.env.TRANSFORMMATE_TOKEN_FILE;
    else process.env.TRANSFORMMATE_TOKEN_FILE = oldTokenFile;
    rmSync(directory, { recursive: true, force: true });
  }
}
