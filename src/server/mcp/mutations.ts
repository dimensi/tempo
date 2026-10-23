import 'server-only';
import { createHash } from 'node:crypto';
import { mcpExtraSchemas, type McpExtraTool } from '@/contracts/mcp-writes';
import { authorize } from '@/server/auth/guards';
import { getDataSession } from '@/server/auth/data-session';
import { executeWorkoutCommand } from '@/server/workouts/commands';
import {
  listMeasurements,
  saveVersionedMeasurement,
  MeasurementError,
} from '@/server/measurements';
import { measurementVersion } from '@/server/measurements/version';
import { searchSavedExercises } from '@/server/transformmate/catalog';
import { McpReadError, pageRows, readOffset } from './pagination';

function withoutOwner<T extends { ownerId: string }>(value: T) {
  const result = { ...value };
  Reflect.deleteProperty(result, 'ownerId');
  return result;
}
const toolScopes = {
  get_measurements: 'tempo:read',
  search_exercises: 'tempo:read',
  create_workout: 'tempo:workouts:write',
  update_workout: 'tempo:workouts:write',
  transition_workout: 'tempo:workouts:write',
  update_exercise_feedback: 'tempo:workouts:write',
  create_measurement: 'tempo:measurements:write',
  update_measurement: 'tempo:measurements:write',
} as const;
export class McpScopeError extends Error {
  constructor(
    public readonly scope: string,
    public readonly enabled: boolean,
    public readonly requestedScopes: string[],
  ) {
    super('MCP scope required');
  }
}
export const mcpToolScope = (name: McpExtraTool) => toolScopes[name];
export async function executeMcpTool(
  name: McpExtraTool,
  headers: Headers,
  raw: unknown,
) {
  const principal = await getDataSession(headers);
  if (!principal || !('scopes' in principal)) throw new MeasurementError(403);
  const requiredScope = mcpToolScope(name);
  if (!principal.scopes.includes(requiredScope))
    throw new McpScopeError(
      requiredScope,
      principal.allowedScopes.includes(requiredScope),
      [...new Set([...principal.scopes, requiredScope])],
    );
  const ownerId = principal.user.id;
  const namespace = `mcp:${principal.clientId}`;
  let data: Record<string, unknown>;
  let next_cursor: string | null = null;
  if (name === 'get_measurements' || name === 'search_exercises') {
    const input =
      name === 'get_measurements'
        ? mcpExtraSchemas.get_measurements.parse(raw)
        : mcpExtraSchemas.search_exercises.parse(raw);
    let records: unknown[];
    if (name === 'get_measurements' && 'from' in input) {
      const rows = await listMeasurements(headers, ownerId);
      records = rows
        .filter(
          (row) => row.measuredAt >= input.from && row.measuredAt <= input.to,
        )
        .map((row) => ({
          ...withoutOwner(row),
          source: 'LOCAL',
          editable: true,
          version: measurementVersion(row),
        }));
      data = {
        source: 'LOCAL',
        units: { weight: 'kg', circumference: 'cm' },
        range: { from: input.from, to: input.to },
      };
    } else {
      const access = await authorize(headers, 'workouts:read', ownerId);
      if (!access.ok) throw new MeasurementError(access.status);
      const saved = await searchSavedExercises(
        headers,
        ownerId,
        mcpExtraSchemas.search_exercises.parse(raw).query,
      );
      records = saved.records;
      data = {
        source: 'TransformMate',
        coverage: saved.coverage,
        unknownAliasCount: saved.unknownAliasCount,
        fetchedAt: saved.fetchedAt,
      };
    }
    const { cursor, limit, ...query } = input;
    const binding = createHash('sha256')
      .update(JSON.stringify([ownerId, name, query]))
      .digest('hex');
    const page = pageRows(records, readOffset(cursor, binding), limit, binding);
    data.records = page.records;
    next_cursor = page.next_cursor;
  } else if (name === 'create_measurement' || name === 'update_measurement') {
    const input =
      name === 'create_measurement'
        ? mcpExtraSchemas.create_measurement.parse(raw)
        : mcpExtraSchemas.update_measurement.parse(raw);
    const record = withoutOwner(
      await saveVersionedMeasurement(headers, ownerId, namespace, input),
    );
    data = { source: 'LOCAL', measurement: record };
  } else {
    const command =
      name === 'create_workout'
        ? {
            kind: 'create' as const,
            input: mcpExtraSchemas.create_workout.parse(raw),
          }
        : name === 'update_workout'
          ? {
              kind: 'update' as const,
              input: mcpExtraSchemas.update_workout.parse(raw),
            }
          : name === 'transition_workout'
            ? {
                kind: 'transition' as const,
                input: mcpExtraSchemas.transition_workout.parse(raw),
              }
            : {
                kind: 'feedback' as const,
                input: mcpExtraSchemas.update_exercise_feedback.parse(raw),
              };
    const result = await executeWorkoutCommand(
      headers,
      ownerId,
      namespace,
      command,
    );
    const { id, date, title, revision, status, updatedAt, exercises } =
      result.workout;
    // Mutation success must fit even when an existing workout is larger than a read page.
    const workout = {
      id,
      date,
      title,
      revision,
      status,
      updatedAt,
      exerciseCount: exercises.length,
    };
    data = {
      source: 'LOCAL',
      workout,
      sync: result.sync,
      syncScope: 'saved_state_at_commit',
      details: {
        tool: 'get_workout',
        arguments: { workoutRef: { kind: 'workout', id, date }, limit: 1 },
      },
    };
  }
  if (!data) throw new McpReadError('not_found');
  return { version: 1 as const, data, next_cursor };
}
