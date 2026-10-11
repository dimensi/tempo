import { getNutritionDay } from '@/server/nutrition';
import { respond, json } from '@/server/nutrition/http';
export async function GET(
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
