import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { ImportQueue } from '@/features/anamnesis';

export const metadata = { title: m.imports.title };

export default async function Page() {
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.errors.denied}</p>;
  const access = await authorize(requestHeaders, 'anamnesis:read', ownerId);
  if (!access.ok) return <p>{m.errors.denied}</p>;
  return <ImportQueue ownerId={ownerId} />;
}
