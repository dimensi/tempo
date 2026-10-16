import {
  resolveSyncPeriod,
  syncRequestSchema,
} from '@/contracts/nutrition-sync';
import { withApiErrors } from '@/server/auth/api-response';
import { runNutritionSync } from '@/server/jobs/nutrition-scheduler';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import { refreshYazioAccount, yazioOwner } from '@/server/yazio/settings';
async function POSTHandler(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const input = syncRequestSchema.parse(
      JSON.parse((await readBody(request, 2048)).toString()),
    );
    const period = resolveSyncPeriod(input);
    const sync = await runNutritionSync(ownerId, period, {
      mode: 'manual',
      timezone: input.timezone ?? 'UTC',
    });
    if (
      (sync.state === 'completed' && sync.completedDates.length > 0) ||
      (sync.state === 'partial' &&
        sync.failedDates.length === 0 &&
        sync.completedDates.length > 0)
    )
      await refreshYazioAccount(request.headers);
    await yazioOwner(request.headers);
    return json(sync);
  });
}

export const POST = withApiErrors(POSTHandler);
