import { configuredStore, yazioOwner } from '@/server/yazio/settings';
import { nutritionUpstream } from '@/server/yazio/adapter';
import { syncNutritionPeriod } from '@/server/jobs/nutrition-sync';
import { nutritionRepository } from '@/server/nutrition/repository';
import { json, respond, sameOrigin, readBody } from '@/server/nutrition/http';
import { syncRequestSchema } from '@/contracts/nutrition-sync';
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const input = syncRequestSchema.parse(
      JSON.parse((await readBody(request, 2048)).toString()),
    );
    const period =
      input.mode === 'period'
        ? { from: input.from, to: input.to }
        : {
            from: new Date(
              Date.parse(input.through) - (input.days - 1) * 86400000,
            )
              .toISOString()
              .slice(0, 10),
            to: input.through,
          };
    return json(
      await syncNutritionPeriod(
        ownerId,
        period,
        await nutritionUpstream(configuredStore()),
        nutritionRepository(),
      ),
    );
  });
}
