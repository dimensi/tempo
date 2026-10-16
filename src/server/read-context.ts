import { readContextSchema } from '@/contracts/read-context';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { getAuth } from '@/server/auth';
import { readServerEnv } from '@/server/env';
import { createHmac } from 'node:crypto';
import 'server-only';
export async function readContext(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const ownerId = (await getAccessibleOwnerId(headers)) ?? '';
  const partition = createHmac('sha256', readServerEnv().BETTER_AUTH_SECRET!)
    .update(
      JSON.stringify(
        session.user.role === 'OWNER'
          ? ['offline-owner/v1', session.user.id]
          : ['offline-reader/v2', session.user.id, session.user.role, ownerId],
      ),
    )
    .digest('base64url');
  return readContextSchema.parse({
    readerId: session.user.id,
    ownerId,
    role: session.user.role,
    partition,
  });
}
