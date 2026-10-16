import { jsonBody, respond } from '@/server/access/http';
import { listTrainers, setTrainerGrant } from '@/server/access/trainers';
import { withApiErrors } from '@/server/auth/api-response';
async function GETHandler(request: Request) {
  return respond(() =>
    listTrainers(
      request.headers,
      new URL(request.url).searchParams.get('ownerId') ?? '',
    ),
  );
}
async function POSTHandler(request: Request) {
  return respond(async () =>
    setTrainerGrant(request.headers, await jsonBody(request), true),
  );
}
async function DELETEHandler(request: Request) {
  return respond(async () =>
    setTrainerGrant(request.headers, await jsonBody(request), false),
  );
}

export const GET = withApiErrors(GETHandler);

export const POST = withApiErrors(POSTHandler);

export const DELETE = withApiErrors(DELETEHandler);
