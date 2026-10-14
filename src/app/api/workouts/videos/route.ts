import { listVideos, createVideo } from '@/server/workouts/videos';
import { workoutResponse } from '@/server/workouts/http';
export const GET = (request: Request) =>
  workoutResponse(() => listVideos(request));
export const POST = (request: Request) =>
  workoutResponse(() => createVideo(request));
