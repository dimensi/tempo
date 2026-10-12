import { catalogResponse, listExercises } from '@/server/transformmate/catalog';
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return catalogResponse(async () => ({
    items: await listExercises(
      request.headers,
      query.get('ownerId') ?? '',
      query.get('q') ?? '',
    ),
  }));
}
