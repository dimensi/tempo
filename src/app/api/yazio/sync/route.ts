import {
  resolveSyncPeriod,
  syncRequestSchema,
} from '@/contracts/nutrition-sync';
import { withApiErrors } from '@/server/auth/api-response';
import {
  getNutritionLiveStatus,
  refreshRecentNutrition,
  runNutritionSync,
} from '@/server/jobs/nutrition-scheduler';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import { refreshYazioAccount, yazioOwner } from '@/server/yazio/settings';
async function POSTHandler(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const input = syncRequestSchema.parse(
      JSON.parse((await readBody(request, 2048)).toString()),
    );
    const sync =
      input.mode === 'history'
        ? await runNutritionSync(ownerId, resolveSyncPeriod(input), {
            mode: 'manual',
            timezone: input.timezone,
          })
        : await refreshRecentNutrition(ownerId, input.timezone);
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

export const GET = withApiErrors(async (request: Request) =>
  respond(async () =>
    json(getNutritionLiveStatus(await yazioOwner(request.headers))),
  ),
);
export const POST = withApiErrors(POSTHandler);
