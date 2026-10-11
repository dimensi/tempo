import { changeComment } from '@/server/comments/service';
import { respond, jsonBody } from '@/server/access/http';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return respond(async () =>
    changeComment(
      request.headers,
      (await context.params).id,
      await jsonBody(request),
      false,
    ),
  );
}
export async function DELETE(request: Request, context: Context) {
  return respond(async () =>
    changeComment(
      request.headers,
      (await context.params).id,
      await jsonBody(request),
      true,
    ),
  );
}
