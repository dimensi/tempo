import { z } from 'zod';
import { cardioCommandSchema } from '@/contracts/cardio-workouts';
import { withApiErrors } from '@/server/auth/api-response';
import { getDatabase } from '@/server/db';
import {
  executeCardioCommand,
  requireCardioAccess,
} from '@/server/workouts/cardio';
import {
  cardioRepository,
  CardioError,
} from '@/server/workouts/cardio-repository';
import {
  checkWorkoutOrigin,
  readWorkoutJson,
  workoutResponse,
} from '@/server/workouts/http';
import { NutritionSyncBusyError } from '@/server/jobs/nutrition-sync';
import { runNutritionSync } from '@/server/jobs/nutrition-scheduler';

const querySchema = z.strictObject({
  ownerId: z.string().min(1).max(128),
  date: z.iso.date(),
});
export const GET = withApiErrors(async (request: Request) => {
  try {
    const url = new URL(request.url);
    const { ownerId, date } = querySchema.parse({
      ownerId: url.searchParams.get('ownerId'),
      date: url.searchParams.get('date'),
    });
    await requireCardioAccess(request.headers, ownerId);
    return Response.json(
      cardioRepository(getDatabase().db).day(ownerId, date),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    return workoutResponse(async () => {
      throw error;
    });
  }
});

const writeSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('refresh'), ...querySchema.shape }),
  z.strictObject({
    action: z.literal('save'),
    ownerId: querySchema.shape.ownerId,
    command: cardioCommandSchema,
  }),
]);
export const POST = withApiErrors(async (request: Request) =>
  workoutResponse(async () => {
    checkWorkoutOrigin(request);
    const body = writeSchema.parse(await readWorkoutJson(request));
    if (body.action === 'save')
      return executeCardioCommand(
        request.headers,
        body.ownerId,
        'web',
        body.command,
      );
    await requireCardioAccess(request.headers, body.ownerId, true);
    try {
      const result = await runNutritionSync(
        body.ownerId,
        { from: body.date, to: body.date },
        {
          mode: 'day-refresh',
          exercisesOnly: true,
        },
      );
      return { refreshed: !result.failedExerciseDates?.includes(body.date) };
    } catch (error) {
      if (error instanceof NutritionSyncBusyError) throw new CardioError(409);
      throw error;
    }
  }),
);
