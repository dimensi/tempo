import {
  catalogResponse,
  muscleDictionary,
} from '@/server/transformmate/catalog';
export async function GET(request: Request) {
  return catalogResponse(() =>
    muscleDictionary(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}
