import { listComments, createComment } from '@/server/comments/service';
import { respond, jsonBody } from '@/server/access/http';
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return respond(() =>
    listComments(request.headers, {
      ownerId: q.get('ownerId'),
      target: { type: q.get('type'), id: q.get('targetId') },
    }),
  );
}
export async function POST(request: Request) {
  return respond(async () =>
    createComment(request.headers, await jsonBody(request)),
  );
}
