import { ZodError } from 'zod';
import { hasTrustedOrigin } from '@/server/auth/origin';
import {
  getStepsGoal,
  saveStepsGoal,
  StepsGoalError,
} from '@/server/settings/steps-goal';
import { stepsGoalMessages as m } from '@/contracts/steps-goal';

const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  const status =
    error instanceof StepsGoalError
      ? error.status
      : error instanceof ZodError || error instanceof SyntaxError
        ? 400
        : 500;
  return Response.json(
    {
      error:
        status === 400
          ? m.invalid
          : status === 401 || status === 403
            ? m.denied
            : m.failed,
    },
    { status, headers },
  );
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) throw new StepsGoalError(400);
    return Response.json(await getStepsGoal(request.headers), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) throw new StepsGoalError(403);
    if (new URL(request.url).search) throw new StepsGoalError(400);
    const body = await request.text();
    if (Buffer.byteLength(body) > 1024) throw new StepsGoalError(400);
    return Response.json(
      await saveStepsGoal(request.headers, JSON.parse(body)),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
