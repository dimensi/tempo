import { withApiErrors } from '@/server/auth/api-response';
import { progressResponse } from '@/server/workouts/progress-http';
export const GET = withApiErrors((request: Request) =>
  progressResponse(request, 'history'),
);
