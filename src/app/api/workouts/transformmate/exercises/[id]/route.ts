import {
  catalogResponse,
  exerciseInfo,
  exerciseId,
} from '@/server/transformmate/catalog';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return catalogResponse(() =>
    exerciseInfo(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
      exerciseId(id),
    ),
  );
}
