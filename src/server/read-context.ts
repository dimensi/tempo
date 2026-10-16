import 'server-only';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { authorize } from '@/server/auth/guards';
import { offlineIdentity } from '@/server/offline';
import { readContextSchema } from '@/contracts/read-context';
export async function readContext(headers: Headers) {
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) return null;
  const access = await authorize(headers, 'nutrition:read', ownerId);
  if (!access.ok) return null;
  const identity = await offlineIdentity(
    headers,
    new URL('http://localhost/api/offline/identity'),
  );
  return readContextSchema.parse({
    readerId: access.session.user.id,
    ownerId,
    role: identity.role,
    partition: identity.partition,
    connectionGeneration: identity.connectionGeneration,
  });
}
