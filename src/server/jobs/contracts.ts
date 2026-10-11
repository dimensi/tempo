import type { NutritionDay, Measurement, Workout } from '@/contracts/v1';
// Extension point only. No scheduler or synchronization is enabled.
export interface NormalizedSyncBatch {
  nutrition: NutritionDay[];
  measurements: Measurement[];
  workouts: Workout[];
}
export interface SyncAdapter {
  fetch(options: {
    from: string;
    to: string;
    signal: AbortSignal;
  }): Promise<NormalizedSyncBatch>;
}
