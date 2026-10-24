import { withApiErrors } from '@/server/auth/api-response';
import { workoutEvents } from '@/server/workouts/events';
import { workoutResponse } from '@/server/workouts/http';

export const GET = withApiErrors(async (request: Request) => {
  try {
    return await workoutEvents(
      request,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    );
  } catch (error) {
    return workoutResponse(async () => {
      throw error;
    });
  }
});
