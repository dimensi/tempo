import { z } from 'zod';
import { readContext } from '@/server/read-context';
import { readWorkoutDetails } from '@/server/workouts/details';
import { workoutDetailSchema } from '@/contracts/read-workout';
export async function GET(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (!context)
      return Response.json({ error: 'Access denied' }, { status: 403 });
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? '';
    const date = z.iso.date().parse(url.searchParams.get('date'));
    const plan = path.match(/^\/workouts\/plans\/([^/]+)\/workouts\/([^/]+)$/);
    const item = path.match(/^\/workouts\/(sessions|native|links)\/([^/]+)$/);
    const resource = plan
      ? {
          kind: 'plan' as const,
          planId: decodeURIComponent(plan[1]!),
          workoutId: decodeURIComponent(plan[2]!),
        }
      : item?.[1] === 'sessions'
        ? { kind: 'session' as const, id: decodeURIComponent(item[2]!) }
        : item?.[1] === 'native'
          ? {
              kind: 'native' as const,
              id: z.coerce.number().int().positive().parse(item[2]),
            }
          : item?.[1] === 'links'
            ? { kind: 'link' as const, id: decodeURIComponent(item[2]!) }
            : null;
    if (!resource)
      return Response.json({ error: 'Invalid route' }, { status: 400 });
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
