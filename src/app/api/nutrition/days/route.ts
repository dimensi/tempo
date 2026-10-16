import { withApiErrors } from '@/server/auth/api-response';
import { listNutritionDays } from '@/server/nutrition';
import { json, respond } from '@/server/nutrition/http';
async function GETHandler(request: Request) {
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

export const GET = withApiErrors(GETHandler);
