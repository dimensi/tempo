import { withApiErrors } from '@/server/auth/api-response';
import { exerciseTechniqueRequest } from '@/server/transformmate/technique-api';

const handle = withApiErrors(
  async (
    request: Request,
    context: { params: Promise<{ id: string; path?: string[] }> },
  ) => {
    const { id, path } = await context.params;
    return exerciseTechniqueRequest(request, id, path ?? []);
  },
);
export const GET = handle;
export const HEAD = handle;
export const PATCH = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
