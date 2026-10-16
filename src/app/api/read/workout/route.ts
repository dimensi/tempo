import { workoutDetailSchema } from '@/contracts/read-workout';
import { withApiErrors } from '@/server/auth/api-response';
import { readContext } from '@/server/read-context';
import { readWorkoutDetails } from '@/server/workouts/details';
import { z } from 'zod';
async function GETHandler(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context?.ownerId)
      return Response.json(
        { error: 'Access denied' },
        { status: context ? 403 : 401 },
      );
    const url = new URL(request.url);
    const query = url.searchParams;
    const date = z.iso.date().parse(query.get('date'));
    const kind = z
      .enum(['plan', 'session', 'native', 'link'])
      .parse(query.get('kind'));
    const id = z.string().min(1).max(200);
    const resource =
      kind === 'plan'
        ? {
            kind,
            planId: id.parse(query.get('planId')),
            workoutId: id.parse(query.get('workoutId')),
          }
        : kind === 'native'
          ? {
              kind,
              id: z.coerce.number().int().positive().parse(query.get('id')),
            }
          : { kind, id: id.parse(query.get('id')) };
    const data = await readWorkoutDetails(
      request.headers,
      context.ownerId,
      resource,
      date,
    );
    return Response.json(
      data ? workoutDetailSchema.parse(data) : { error: 'Not found' },
      {
        status: data ? 200 : 404,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    const status =
      error instanceof z.ZodError
        ? 400
        : error && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : 503;
    return Response.json({ error: 'Read unavailable' }, { status });
  }
}

export const GET = withApiErrors(GETHandler);
