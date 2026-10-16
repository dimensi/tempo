import { withApiErrors } from '@/server/auth/api-response';
import { catalogResponse, listCatalog } from '@/server/transformmate/catalog';
async function GETHandler(request: Request) {
  const query = new URL(request.url).searchParams;
  return catalogResponse(
    () =>
      listCatalog(
        request.headers,
        query.get('ownerId') ?? '',
        {
          query: query.get('q') ?? '',
          commonMuscleGroup: query.get('commonMuscleGroup'),
          muscleGroups: query.getAll('muscleGroup'),
          offset: Number(query.get('offset') ?? 0),
          limit: Number(query.get('limit') ?? 50),
        },
        query.getAll('visible').map(Number),
      ),
    true,
  );
}

export const GET = withApiErrors(GETHandler);
