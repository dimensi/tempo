import { readContext } from '@/server/read-context';
import { getYazioStatus } from '@/server/yazio/settings';
import { getTransformMateStatus } from '@/server/transformmate/connection';
import { listTrainers } from '@/server/access/trainers';
import { getStepsGoal } from '@/server/settings/steps-goal';
import { authorize } from '@/server/auth/guards';
import { readSettingsSchema } from '@/contracts/read-settings';
export async function GET(request: Request) {
  try {
    const context = await readContext(request.headers);
    if (
      !context ||
      !(await authorize(request.headers, 'trainers:manage', context.ownerId)).ok
    )
      return Response.json({ error: 'Access denied' }, { status: 403 });
    const [yazio, transformMate, trainers, stepsGoal] = await Promise.all([
      getYazioStatus(request.headers),
      getTransformMateStatus(request.headers),
      listTrainers(request.headers, context.ownerId),
      getStepsGoal(request.headers),
    ]);
    if (
      !(await authorize(request.headers, 'trainers:manage', context.ownerId)).ok
    )
      return Response.json({ error: 'Access denied' }, { status: 403 });
    return Response.json(
      readSettingsSchema.parse({ yazio, transformMate, trainers, stepsGoal }),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number(error.status)
        : 503;
    return Response.json({ error: 'Read unavailable' }, { status });
  }
}
