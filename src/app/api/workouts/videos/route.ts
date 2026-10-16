import { withApiErrors } from '@/server/auth/api-response';
import { listVideos, createVideo } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
export const GET = withApiErrors((request: Request) =>
  workoutResponse(() => listVideos(request)),
);
export const POST = withApiErrors((request: Request) =>
  workoutResponse(() => createVideo(request)),
);
