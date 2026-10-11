import { configuredStore, yazioOwner } from '@/server/yazio/settings';
import { nutritionUpstream } from '@/server/yazio/adapter';
import { syncNutritionPeriod } from '@/server/jobs/nutrition-sync';
import { nutritionRepository } from '@/server/nutrition/repository';
import { json, respond, sameOrigin, readBody } from '@/server/nutrition/http';
import { resolveSyncPeriod } from '@/contracts/nutrition-sync';
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const ownerId = await yazioOwner(request.headers);
    const period = resolveSyncPeriod(
      JSON.parse((await readBody(request, 2048)).toString()),
    );
    return json(
      await syncNutritionPeriod(
        ownerId,
        period,
        await nutritionUpstream(configuredStore(ownerId)),
        nutritionRepository(),
      ),
    );
  });
}
