import { z } from 'zod';
import { withApiErrors } from '@/server/auth/api-response';
import { refreshOverviewNutrition } from '@/server/jobs/nutrition-scheduler';
import { json, readBody, respond, sameOrigin } from '@/server/nutrition/http';
import { yazioOwner } from '@/server/yazio/settings';
import { timezoneSchema } from '@/contracts/nutrition-sync-dates';
export const POST = withApiErrors(async (request: Request) =>
  respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const input = z
      .strictObject({ timezone: timezoneSchema })
      .parse(JSON.parse((await readBody(request, 1024)).toString()));
    const result = await refreshOverviewNutrition(ownerId, input.timezone);
    await yazioOwner(request.headers);
    return json(result);
  }),
);
