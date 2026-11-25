import 'server-only';
import { standaloneCardio } from '@/lib/cardio-workouts';
import { cardioUnits, mcpCardioRange } from './cardio';
import { createHash } from 'node:crypto';
import type { BodyObservation } from '@/contracts/analytics';
import { getCommentCounts } from '@/server/comments/reads';
import { commentReference } from './comments';
import { getAnalytics } from '@/server/analytics';
import {
  getSavedDataFreshness,
  summarizeSavedSource,
  unavailableSavedSource,
} from '@/server/analytics/freshness';
import { savedWorkoutFreshnessSchema } from '@/contracts/data-freshness';
import { authorize } from '@/server/auth/guards';
import { listNutritionDays } from '@/server/nutrition';
import { listSavedWorkouts } from '@/server/workouts/saved-read';
import { exerciseHistoryRef } from './workouts';
import { getDailyGoals } from '@/server/settings/daily-goals';
import { getNutritionSchedule } from '@/server/jobs/nutrition-scheduler';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import { measurementMetrics } from '@/contracts/measurements';
import { healthRangeDates } from '@/contracts/health';
import type {
  McpHistoryInput,
  McpOutput,
  McpTool,
  McpWorkoutExecutionStatus,
} from '@/contracts/mcp';
import { McpReadError, pageRows, readOffset } from './pagination';
import { providerExecutionStatus } from '@/server/workouts/execution-status';
import { readMcpRecovery } from './recovery';

async function check(headers: Headers, ownerId: string) {
  for (const permission of [
    'nutrition:read',
    'measurements:read',
    'workouts:read',
  ] as const) {
    const access = await authorize(headers, permission, ownerId);
    if (!access.ok || access.session.user.role !== 'OWNER')
      throw new McpReadError('access_denied');
  }
}
const units = {
  calories: 'kcal',
  protein: 'g',
  fat: 'g',
  carbs: 'g',
  weight: 'kg',
  circumference: 'cm',
  steps: 'steps',
  workoutWeight: 'kg',
  reps: 'repetitions',
};

export async function readMcpData(
  tool: Exclude<
    McpTool,
    'get_workout' | 'get_exercise_history' | 'get_comments'
  >,
  headers: Headers,
  ownerId: string,
  query?: McpHistoryInput,
): Promise<McpOutput> {
  if (tool === 'get_sleep_recovery') {
    if (!query) throw new McpReadError('invalid_arguments');
    return readMcpRecovery(headers, ownerId, query);
  }
  await check(headers, ownerId);
  if (tool === 'get_profile') {
    const goal = await getDailyGoals(
      headers,
      ownerId,
      dateInTimezone(new Date(), getNutritionSchedule(ownerId).timezone),
    );
    await check(headers, ownerId);
    return {
      version: 1 as const,
      data: {
        source: 'LOCAL',
        role: 'OWNER',
        units,
        goals: {
          date: goal.date,
          fetchedAt: goal.fetchedAt,
          dailySteps: goal.steps,
          nutrition: goal.calories,
          weight: goal.weight,
        },
        coverage: {
          dailySteps: goal.steps === null ? 'missing' : 'recorded',
          nutrition: goal.calories === null ? 'missing' : 'recorded',
          weight: goal.weight === null ? 'missing' : 'recorded',
        },
        dates: 'YYYY-MM-DD; diary/provider calendar dates, not UTC instants',
      },
      next_cursor: null,
    };
  }
  if (!query) throw new McpReadError('invalid_arguments');
  const { from, to, timezone, detail, limit, cursor } = query;
  const range = { from, to };
  const binding = createHash('sha256')
    .update(JSON.stringify([ownerId, tool, from, to, timezone, detail]))
    .digest('hex');
  if (cursor && detail === 'summary' && tool !== 'get_workouts')
    throw new McpReadError('invalid_cursor');
  const offset = readOffset(cursor, binding);
  let data: Record<string, unknown>;
  let rows: unknown[] = [];
  let next_cursor: string | null = null;
  if (tool === 'get_workouts') {
    const { local, linked, native } = await listSavedWorkouts(
      headers,
      ownerId,
      range,
    );
    const cardio = mcpCardioRange(ownerId, from, to);
    const distinct = standaloneCardio(cardio.rows).map(cardio.view);
    const linkedStrength = new Map(
      cardio.rows
        .filter((row) => row.link?.kind === 'strength')
        .map((row) => [row.link!.id, row]),
    );
    const within = (date: string) => date >= from && date <= to;
    // Each local workout occurs once; status determines plan versus execution semantics.
    const workoutRows: Array<{
      date: string;
      kind: string;
      executionStatus: McpWorkoutExecutionStatus;
      workoutId?: string | null;
      fetchedAt?: string;
      checkedAt?: string | null;
      id: string | number;
      [key: string]: unknown;
    }> = [
      ...local.workouts
        .filter((w) => within(w.date))
        .map((w) => ({
          kind: 'workout',
          workoutRef: { kind: 'workout', id: w.id, date: w.date },
          source: 'LOCAL',
          id: w.id,
          workoutId: w.id,
          revision: w.revision,
          note: w.note,
          editable: true,
          watchMetrics: linkedStrength.has(w.id)
            ? cardio.view(linkedStrength.get(w.id)!)
            : null,
          date: w.date,
          title: w.title,
          executionStatus: w.status,
          coverage:
            w.status === 'planned'
              ? 'planned_only'
              : w.status === 'completed'
                ? 'recorded'
                : 'partial',
          ...(detail === 'records'
            ? {
                exercises: w.exercises.map((e) => ({
                  name: e.name,
                  exerciseId: e.id,
                  comment: e.comment,
                  fatigue: e.fatigue ?? null,
                  failure: e.failure ?? null,
                  historyRef: exerciseHistoryRef(e.transformMate?.exerciseId),
                  ...(w.status === 'planned'
                    ? { plannedSets: e.sets }
                    : { actualSets: e.sets }),
                })),
              }
            : {}),
        })),
      ...linked
        .filter((i) => within(i.actual?.date ?? i.planSnapshot.workout.date))
        .map((i) => {
          const executionStatus = providerExecutionStatus(
            i.actual,
            i.actual?.exercises.flatMap((e) => e.sets) ?? [],
          );
          return {
            kind: 'linked',
            workoutRef: {
              kind: 'linked',
              id: i.id,
              date: i.actual?.date ?? i.planSnapshot.workout.date,
            },
            source: 'TransformMate',
            id: i.id,
            planId: i.planId,
            workoutId: i.workoutId,
            date: i.actual?.date ?? i.planSnapshot.workout.date,
            title: i.actual?.title ?? i.planSnapshot.workout.title,
            checkedAt:
              [i.checkedAt, i.updateAttempt?.checkedAt]
                .filter((value): value is string => value != null)
                .sort((a, b) => Date.parse(a) - Date.parse(b))
                .at(-1) ?? null,
            executionStatus,
            coverage: !i.actual
              ? 'missing'
              : executionStatus === 'not_started'
                ? 'empty'
                : executionStatus === 'completed'
                  ? 'recorded'
                  : 'partial',
            ...(detail === 'records'
              ? {
                  plannedExercises: (
                    i.publishedSnapshot ?? i.planSnapshot
                  ).workout.exercises.map((e) => ({
                    name: e.name,
                    historyRef: exerciseHistoryRef(e.transformMate?.exerciseId),
                    plannedSets: e.sets,
                  })),
                  actual: i.actual
                    ? {
                        started: i.actual.started,
                        finished: i.actual.finished,
                        exercises: i.actual.exercises.map((e) => ({
                          name: e.name,
                          historyRef: exerciseHistoryRef(e.exerciseId),
                          actualSets: e.sets,
                        })),
                      }
                    : null,
                }
              : {}),
          };
        }),
    ];
    workoutRows.push(
      ...native.map((i) => ({
        kind: 'native',
        workoutRef: { kind: 'native', id: i.remoteTrainingId, date: i.date },
        source: 'TransformMate',
        id: i.remoteTrainingId,
        date: i.date,
        title: i.title,
        started: i.started,
        finished: i.finished,
        progress: i.progress,
        fetchedAt: i.fetchedAt,
        executionStatus: providerExecutionStatus(
          i,
          i.exercises.flatMap((e) =>
            e.metrics.filter((m) => m.type === 'fact').flatMap((m) => m.sets),
          ),
        ),
        coverage: 'provider_snapshot',
        ...(detail === 'records'
          ? {
              exercises: i.exercises.map((e) => ({
                name: e.name,
                historyRef: exerciseHistoryRef(e.exerciseId),
                metrics: e.metrics,
              })),
            }
          : {}),
      })),
    );
    workoutRows.push(...distinct);
    const commentCounts = await getCommentCounts(
      headers,
      ownerId,
      'workout',
      workoutRows.flatMap((row) => (row.workoutId ? [row.workoutId] : [])),
    );
    for (const row of workoutRows)
      row.comments = row.workoutId
        ? commentReference(
            { type: 'workout', id: row.workoutId },
            commentCounts.get(row.workoutId) ?? 0,
          )
        : null;
    workoutRows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.kind.localeCompare(b.kind) ||
        String(a.id).localeCompare(String(b.id)),
    );
    const completed = workoutRows.filter(
      (row) => row.executionStatus === 'completed',
    );
    // Provider facts stay read-only; flag overlap with the canonical local execution.
    const completionCountAmbiguous = completed.some(
      (row) =>
        row.kind === 'linked' &&
        completed.some(
          (other) =>
            other.kind === 'workout' &&
            other.workoutId === row.workoutId &&
            other.date === row.date,
        ),
    );
    const paged = pageRows(workoutRows, offset, limit, binding);
    const endurance = distinct.filter((row) => row.activity === 'cardio');
    const totals = {
      durationSeconds: { sum: 0, observed: 0 },
      distanceMeters: { sum: 0, observed: 0 },
      energyKcal: { sum: 0, observed: 0 },
    };
    for (const { metrics } of endurance) {
      for (const key of [
        'durationSeconds',
        'distanceMeters',
        'energyKcal',
      ] as const) {
        const value = metrics[key];
        if (value === null) continue;
        totals[key].sum += value;
        totals[key].observed++;
      }
    }
    const cardioTotals = Object.fromEntries(
      Object.entries(totals).map(([key, { observed, sum }]) => [
        key,
        { observed, sum: observed ? sum : null },
      ]),
    );
    const fetchedDays = cardio.coverage.filter((day) => day.fetchedAt).length;
    const failedDays = cardio.coverage.filter((day) => day.failedAt).length;
    const rangeDays = 1 + (Date.parse(to) - Date.parse(from)) / 86400000;
    data = {
      range,
      units: { ...units, ...cardioUnits },
      sources: ['LOCAL', 'TransformMate', 'YAZIO'],
      summary: {
        completedSessions: completionCountAmbiguous ? null : completed.length,
        completionCountAmbiguous,
        cardioSessions: endurance.length,
        cardioTotals,
        linkedStrengthSessions: linkedStrength.size,
      },
      coverage: {
        scope: 'locally_saved_records',
        recordCounts: Object.fromEntries(
          ['workout', 'linked', 'native', 'cardio'].map((kind) => [
            kind,
            workoutRows.filter((row) => row.kind === kind).length,
          ]),
        ),
        upstreamCompleteness: 'unknown',
        noRecordsMeans: 'no_saved_workout_not_confirmed_rest',
        yazioExercises: {
          fetchedDays,
          failedDays,
          missingDays: rangeDays - fetchedDays,
        },
        executionStatusRequiredForCounting: true,
      },
      freshness: {
        yazioExercises: {
          latestSuccessfulFetchAt:
            cardio.coverage
              .flatMap((day) => (day.fetchedAt ? [day.fetchedAt] : []))
              .sort()
              .at(-1) ?? null,
          latestFailureAt:
            cardio.coverage
              .flatMap((day) => (day.failedAt ? [day.failedAt] : []))
              .sort()
              .at(-1) ?? null,
        },
        transformmateLinked: summarizeSavedSource(
          'TransformMate',
          workoutRows
            .filter((r) => r.kind === 'linked')
            .map((r) => ({
              date: r.date,
              checkedAt: r.checkedAt,
            })),
        ),
        transformmateNative: summarizeSavedSource(
          'TransformMate',
          workoutRows
            .filter((r) => r.kind === 'native')
            .map((r) => ({ date: r.date, fetchedAt: r.fetchedAt })),
        ),
      },
      records: paged.records,
    };
    next_cursor = paged.next_cursor;
  } else {
    const analytics = await getAnalytics(headers, ownerId, range, timezone);
    const n = analytics.nutrition;
    const b = analytics.body;
    const a = analytics.activity;
    const nutritionCoverage =
      n.state === 'ready'
        ? {
            complete: n.data.completeDays,
            partial: n.data.partialDays,
            empty: n.data.emptyDays,
            missing: n.data.missingDays,
            updatedAt: n.data.updatedAt,
          }
        : { state: 'unavailable' };
    const bodyCoverage =
      b.state === 'ready'
        ? Object.fromEntries(
            measurementMetrics.map((metric) => [
              metric,
              {
                observations: b.data.metrics[metric].observations.length,
                missingValues: b.data.metrics[metric].observations.filter(
                  (o) => o.value === null,
                ).length,
              },
            ]),
          )
        : { state: 'unavailable' };
    const activityCoverage =
      a.state === 'ready'
        ? {
            observedDays: a.data.summary.observedDays,
            partialDays: a.data.summary.days.filter(
              (d) => d.steps === null && d.source !== null,
            ).length,
            missingDays: a.data.summary.days.filter((d) => d.source === null)
              .length,
            updatedAt: a.data.updatedAt,
          }
        : { state: 'unavailable' };
    data = { range, timezone, sources: ['LOCAL', 'YAZIO'] };
    if (tool === 'get_nutrition') {
      if (n.state !== 'ready') throw new McpReadError('data_unavailable');
      data = {
        ...data,
        sources: ['YAZIO'],
        units: { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g' },
        coverage: nutritionCoverage,
        nutrients: n.data.summary.nutrients,
        macros: n.data.macros,
      };
      if (detail === 'daily') rows = n.data.days;
      if (detail === 'records')
        rows = (await listNutritionDays(headers, ownerId, range)).flatMap((d) =>
          d.meals.flatMap((m) =>
            m.entries.map((e) => ({
              date: d.date,
              source: 'YAZIO',
              meal: m.kind,
              name: e.name,
              massG: e.massG,
              volumeMl: e.volumeMl,
              totals: e.totals,
              issues: e.issues,
            })),
          ),
        );
    } else if (tool === 'get_body_metrics') {
      if (b.state !== 'ready') throw new McpReadError('data_unavailable');
      const commentCounts = await getCommentCounts(
        headers,
        ownerId,
        'measurement',
        b.data.measurements.map((row) => row.id),
      );
      const withComments = (observation: BodyObservation | null) =>
        observation
          ? {
              ...observation,
              comments:
                observation.source === 'LOCAL'
                  ? commentReference(
                      { type: 'measurement', id: observation.id },
                      commentCounts.get(observation.id) ?? 0,
                    )
                  : null,
            }
          : null;
      data = {
        ...data,
        coverage: bodyCoverage,
        comments: {
          count: [...commentCounts.values()].reduce(
            (total, value) => total + value,
            0,
          ),
          details: { tool: 'get_measurements', arguments: range },
        },
        metrics: Object.fromEntries(
          measurementMetrics.map((metric) => {
            const { first, latest, delta, weeklyRate, ambiguousEndpoints } =
              b.data.metrics[metric];
            return [
              metric,
              {
                first: withComments(first),
                latest: withComments(latest),
                delta,
                weeklyRate,
                ambiguousEndpoints,
                unit: metric === 'weight' ? 'kg' : 'cm',
              },
            ];
          }),
        ),
      };
      if (detail !== 'summary')
        rows = measurementMetrics.flatMap((metric) =>
          b.data.metrics[metric].observations.map((o) => ({
            ...withComments(o),
            metric,
            unit: metric === 'weight' ? 'kg' : 'cm',
          })),
        );
    } else if (tool === 'get_activity') {
      if (a.state !== 'ready') throw new McpReadError('data_unavailable');
      data = {
        ...data,
        sources: ['YAZIO'],
        units: { steps: 'steps' },
        coverage: activityCoverage,
        totalSteps: a.data.summary.totalSteps,
        averageSteps: a.data.summary.averageSteps,
        dailyGoals: a.data.summary.days.map(({ date, goal }) => ({
          date,
          steps: goal,
        })),
      };
      if (detail !== 'summary') rows = a.data.summary.days;
    } else {
      let workoutCoverage: unknown;
      let workoutFreshness = {
        transformmateLinked: unavailableSavedSource('TransformMate'),
        transformmateNative: unavailableSavedSource('TransformMate'),
      };
      try {
        const workoutResult = await readMcpData(
          'get_workouts',
          headers,
          ownerId,
          {
            ...query,
            detail: 'summary',
            cursor: undefined,
            limit: 1,
          },
        );
        workoutCoverage = workoutResult.data.coverage;
        workoutFreshness = savedWorkoutFreshnessSchema.parse(
          workoutResult.data.freshness,
        );
      } catch (error) {
        if (error instanceof McpReadError && error.code === 'access_denied')
          throw error;
        workoutCoverage = { state: 'unavailable' };
      }
      data = {
        ...data,
        nutrition: nutritionCoverage,
        sources: ['LOCAL', 'YAZIO', 'TransformMate'],
        body: bodyCoverage,
        activity: activityCoverage,
        workouts: workoutCoverage,
        freshness: {
          recordScope: 'requested_range',
          syncScope: 'latest_saved_status_not_range_verification',
          ...(await getSavedDataFreshness(headers, ownerId, range)),
          ...workoutFreshness,
        },
        semantics: {
          null: 'unknown_or_missing',
          zero: 'recorded_zero',
          emptyNutrition: 'saved_empty_diary_excluded_from_means',
          body: 'observations_only_missing_dates_are_not_zero',
        },
      };
      if (detail !== 'summary')
        rows = healthRangeDates(range).map((date) => {
          const steps =
            a.state === 'ready'
              ? a.data.summary.days.find((s) => s.date === date)
              : null;
          return {
            date,
            nutrition:
              n.state === 'ready'
                ? n.data.days.find((d) => d.date === date)?.quality
                : 'unavailable',
            steps:
              a.state !== 'ready'
                ? 'unavailable'
                : steps?.steps != null
                  ? 'recorded'
                  : steps?.source
                    ? 'partial'
                    : 'missing',
            body:
              b.state === 'ready'
                ? Object.fromEntries(
                    measurementMetrics.map((metric) => [
                      metric,
                      b.data.metrics[metric].observations.filter(
                        (o) => o.date === date,
                      ).length,
                    ]),
                  )
                : 'unavailable',
          };
        });
    }
    if (detail !== 'summary') {
      const paged = pageRows(rows, offset, limit, binding);
      data.records = paged.records;
      next_cursor = paged.next_cursor;
    }
  }
  await check(headers, ownerId);
  return { version: 1 as const, data, next_cursor };
}
