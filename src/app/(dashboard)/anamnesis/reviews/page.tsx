import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { ReviewEditor } from '@/features/anamnesis';

export const metadata = { title: m.reviews.title };

export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.errors.denied}</p>;
  const writeAccess = await authorize(
    requestHeaders,
    'anamnesis:write',
    ownerId,
  );
  if (!writeAccess.ok) return <p>{m.errors.denied}</p>;
  return <ReviewEditor ownerId={ownerId} />;
}
