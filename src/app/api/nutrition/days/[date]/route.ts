import { withApiErrors } from '@/server/auth/api-response';
import { getNutritionDay } from '@/server/nutrition';
import { json, respond } from '@/server/nutrition/http';
async function GETHandler(
  request: Request,
  context: { params: Promise<{ date: string }> },
) {
  return respond(async () => {
    const { date } = await context.params;
    const day = await getNutritionDay(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      date,
    );
    return json(day, day ? 200 : 404);
  });
}

export const GET = withApiErrors(GETHandler);
