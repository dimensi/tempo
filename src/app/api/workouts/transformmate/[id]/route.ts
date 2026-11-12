import { z } from 'zod';
import { withApiErrors } from '@/server/auth/api-response';
import { deletePreservedWorkout } from '@/server/workouts/transformmate/service';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutResponse,
} from '@/server/workouts/http';

export const DELETE = withApiErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }) =>
    workoutResponse(async () => {
      checkWorkoutOrigin(request);
      const { ownerId } = z
        .strictObject({ ownerId: z.string().min(1).max(128) })
        .parse(await readWorkoutJson(request));
      await deletePreservedWorkout(
        request.headers,
        ownerId,
        (await context.params).id,
      );
      return null;
    }),
);
