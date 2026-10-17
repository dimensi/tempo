import { withApiErrors } from '@/server/auth/api-response';
import { transformMateResponse } from '@/server/transformmate/http';
import { getReplicaStatus } from '@/server/transformmate/replica-status';
export const GET = withApiErrors((request: Request) =>
  transformMateResponse(() => getReplicaStatus(request.headers)),
);
