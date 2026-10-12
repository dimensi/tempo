import { z } from 'zod';
import { diaryDateSchema } from '@/contracts/nutrition';
import { timezoneSchema } from '@/contracts/nutrition-sync-dates';
import { resolveSyncPeriod } from '@/contracts/nutrition-sync';
import { yazioOwner } from '@/server/yazio/settings';
import { runNutritionSync } from '@/server/jobs/nutrition-scheduler';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';

const inputSchema = z.object({ timezone: timezoneSchema }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ date: string }> },
) {
  return respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const date = diaryDateSchema.parse((await context.params).date);
    const input = inputSchema.parse(
      JSON.parse((await readBody(request, 2048)).toString()),
    );
    const period = resolveSyncPeriod({
      mode: 'period',
      from: date,
      to: date,
      timezone: input.timezone,
    });
    const sync = await runNutritionSync(ownerId, period, {
      mode: 'day-refresh',
      timezone: input.timezone,
    });
    await yazioOwner(request.headers);
    return json(sync);
  });
}
