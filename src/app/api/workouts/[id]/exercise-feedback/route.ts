import { withApiErrors } from '@/server/auth/api-response';
import { updateExerciseFeedback } from '@/server/workouts';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutFeedbackBody,
  workoutResponse,
} from '@/server/workouts/http';
type Context = { params: Promise<{ id: string }> };
export const PATCH = withApiErrors(async (request: Request, context: Context) =>
  workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const { ownerId, revision, requestId, ...feedback } =
      workoutFeedbackBody.parse(await readWorkoutJson(request));
    return updateExerciseFeedback(
      request.headers,
      ownerId,
      (await context.params).id,
      revision,
      feedback,
      requestId,
    );
  }),
);
