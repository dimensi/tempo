import { listNutritionDays } from '@/server/nutrition';
import { respond, json } from '@/server/nutrition/http';
export async function GET(request: Request) {
  return respond(async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await listNutritionDays(request.headers, q.get('ownerId') ?? '', {
        from: q.get('from') ?? '',
        to: q.get('to') ?? '',
      }),
    );
  });
}
