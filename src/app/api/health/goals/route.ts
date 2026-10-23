import { getAccessibleOwnerId } from '@/server/access/owner';
import { getDailyGoals, DailyGoalsError } from '@/server/settings/daily-goals';
import { getAuth } from '@/server/auth';
import { withApiErrors } from '@/server/auth/api-response';
import { z } from 'zod';
const headers = { 'Cache-Control': 'private, no-store' };
export const GET = withApiErrors(async (request: Request) => {
  try {
    const params = new URL(request.url).searchParams;
    const date = z.iso.date().safeParse(params.get('date'));
    if (
      [...params.keys()].some((key) => key !== 'date') ||
      params.getAll('date').length !== 1 ||
      !date.success
    )
      throw new DailyGoalsError(400);
    const ownerId = await getAccessibleOwnerId(request.headers);
    if (!ownerId) {
      const session = await getAuth().api.getSession({
        headers: request.headers,
      });
      throw new DailyGoalsError(session ? 403 : 401);
    }
    return Response.json(
      await getDailyGoals(request.headers, ownerId, date.data),
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: 'goals_unavailable' },
      {
        status: error instanceof DailyGoalsError ? error.status : 500,
        headers,
      },
    );
  }
});
