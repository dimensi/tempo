import { yazioOwner, refreshYazioAccount } from '@/server/yazio/settings';
import { runNutritionSync } from '@/server/jobs/nutrition-scheduler';
import { json, respond, sameOrigin, readBody } from '@/server/nutrition/http';
import {
  resolveSyncPeriod,
  syncRequestSchema,
} from '@/contracts/nutrition-sync';
export async function POST(request: Request) {
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
    if (sync.state === 'completed') await refreshYazioAccount(request.headers);
    await yazioOwner(request.headers);
    return json(sync);
  });
}
