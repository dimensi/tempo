import { listTrainers, setTrainerGrant } from '@/server/access/trainers';
import { respond, jsonBody } from '@/server/access/http';
export async function GET(request: Request) {
  return respond(() =>
    listTrainers(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}
export async function POST(request: Request) {
  return respond(async () =>
    setTrainerGrant(request.headers, await jsonBody(request), true),
  );
}
export async function DELETE(request: Request) {
  return respond(async () =>
    setTrainerGrant(request.headers, await jsonBody(request), false),
  );
}
