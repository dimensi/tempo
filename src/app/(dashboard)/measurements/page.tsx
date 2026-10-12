import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { MeasurementsWithComments } from './with-comments';
import { measurementMessages as m } from '@/features/measurements';
export const metadata = { title: m.title };
export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.denied}</p>;
  const access = await authorize(requestHeaders, 'measurements:read', ownerId);
  if (!access.ok) return <p>{m.denied}</p>;
  const writeAccess = await authorize(
    requestHeaders,
    'measurements:write',
    ownerId,
  );
  return (
    <MeasurementsWithComments ownerId={ownerId} writable={writeAccess.ok} />
  );
}
