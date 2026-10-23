import 'server-only';
import type { McpWorkoutExecutionStatus } from '@/contracts/mcp';

type ProviderSet = {
  done: boolean | null;
  metrics: ReadonlyArray<{ values: readonly string[] }>;
};
export function hasProviderSetData(set: ProviderSet) {
  return (
    set.done === true ||
    set.metrics.some((metric) =>
      metric.values.some((value) => value.trim() !== ''),
    )
  );
}

/** Interpret saved provider evidence; a fact-shaped placeholder is not execution. */
export function providerExecutionStatus(
  actual: {
    started: string | null;
    finished: string | null;
  } | null,
  sets: ReadonlyArray<{
    done: boolean | null;
    metrics: ReadonlyArray<{ values: readonly string[] }>;
  }>,
): McpWorkoutExecutionStatus {
  if (!actual) return 'unknown';
  if (actual.finished) return 'completed';
  if (actual.started || sets.some(hasProviderSetData)) return 'in_progress';
  return 'not_started';
}
