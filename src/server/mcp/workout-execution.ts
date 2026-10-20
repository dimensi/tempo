import 'server-only';
import type { McpWorkoutExecutionStatus } from '@/contracts/mcp';

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
  if (
    actual.started ||
    sets.some(
      (set) =>
        set.done === true ||
        set.metrics.some((metric) =>
          metric.values.some((value) => value.trim() !== ''),
        ),
    )
  )
    return 'in_progress';
  return 'not_started';
}
