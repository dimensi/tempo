import 'server-only';
import type { NutritionScheduleStatus } from '@/contracts/nutrition-schedule';
import { readDiagnostic } from '@/server/yazio/sync-diagnostics';

type Event =
  | 'scheduler_started'
  | 'scheduler_disabled'
  | 'scheduler_stopped'
  | 'scheduler_skipped'
  | 'scheduler_failed'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'sync_auxiliary_failed';
export type NutritionDiagnosticFields = {
  trigger?: 'timer' | 'overview' | 'request';
  mode?: 'manual' | 'recent' | 'day-refresh' | 'automatic';
  runId?: string;
  reason?:
    | 'feature_flag_disabled'
    | 'connection_not_configured'
    | 'no_enabled_owners'
    | 'connection_disabled'
    | 'history_start_in_future'
    | 'run_in_progress'
    | 'attempt_cooldown'
    | 'recent_success'
    | 'lease_conflict';
  stage?:
    'registration' | 'tick' | 'owner' | 'heartbeat' | 'body' | 'lease_release';
  outcome?: 'success' | 'partial' | 'failed';
  code?: NonNullable<NutritionScheduleStatus['lastError']>;
  intervalMs?: number;
  durationMs?: number;
  nextEligibleAt?: string;
  foodFailures?: number;
  photoFailures?: number;
  stepsFailures?: number;
  weightFailures?: number;
  goalsFailures?: number;
  bodyFailed?: boolean;
};

// Only bounded operational metadata. Never pass owner IDs, dates of records,
// paths, payloads, credentials, raw errors/messages/stacks or environment values.
export function nutritionDiagnostic(
  event: Event,
  fields: NutritionDiagnosticFields = {},
  error?: unknown,
) {
  const data = {
    at: new Date().toISOString(),
    ...fields,
    ...(error === undefined ? {} : { diagnostic: readDiagnostic(error) }),
  };
  const output = JSON.stringify(data);
  if (
    event.endsWith('_failed') ||
    fields.outcome === 'partial' ||
    fields.outcome === 'failed'
  )
    console.warn(`yazio_${event}`, output);
  else console.info(`yazio_${event}`, output);
}

// Retain just the latest state per internal scope, across scheduler factories.
// Repeated idle ticks are silent; a changed reason/deadline or an hourly reminder
// remains visible. The scope is deliberately never emitted.
export class NutritionDiagnosticTransitions {
  private states = new Map<string, { signature: string; at: number }>();

  log(
    scope: string,
    event: Event,
    fields: NutritionDiagnosticFields,
    error?: unknown,
  ) {
    const signature = JSON.stringify([
      event,
      fields,
      error === undefined ? null : readDiagnostic(error),
    ]);
    const previous = this.states.get(scope);
    const now = Date.now();
    if (previous?.signature === signature && now - previous.at < 3600000)
      return;
    this.states.set(scope, { signature, at: now });
    nutritionDiagnostic(event, fields, error);
  }

  clear(scope: string) {
    this.states.delete(scope);
  }
}
