import 'server-only';
import {
  resolveSyncPeriod,
  type YazioAccount,
} from '@/contracts/nutrition-sync';
import type { NutritionScheduleInput } from '@/contracts/nutrition-schedule';
import {
  runNutritionSync,
  enableNutritionSchedule,
} from '@/server/jobs/nutrition-scheduler';

export async function loadConnectedDiary(
  ownerId: string,
  schedule: NutritionScheduleInput,
  account: YazioAccount,
) {
  try {
    enableNutritionSchedule(ownerId, schedule);
    // This handler owns the initial job, independently of browser request cancellation.
    const sync = await runNutritionSync(
      ownerId,
      resolveSyncPeriod({
        mode: 'period',
        from: schedule.initialFrom,
        timezone: schedule.timezone,
      }),
      { mode: 'manual', timezone: schedule.timezone },
    );
    return { configured: true as const, account, sync, syncError: null };
  } catch {
    return {
      configured: true as const,
      account,
      sync: null,
      syncError: 'SYNC_FAILED' as const,
    };
  }
}
