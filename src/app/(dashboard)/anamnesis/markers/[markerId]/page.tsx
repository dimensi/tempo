import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { MarkerDetail } from '@/features/anamnesis';

type Props = { params: Promise<{ markerId: string }> };

export function generateMetadata() {
  return { title: m.markers.title };
}

export default async function Page({ params }: Props) {
  const { markerId } = await params;
  await requireSession();
  const requestHeaders = await headers();
  const ownerId = await getAccessibleOwnerId(requestHeaders);
  if (!ownerId) return <p>{m.errors.denied}</p>;
  const access = await authorize(requestHeaders, 'anamnesis:read', ownerId);
  if (!access.ok) return <p>{m.errors.denied}</p>;
  const writeAccess = await authorize(
    requestHeaders,
    'anamnesis:write',
    ownerId,
  );
  return (
    <MarkerDetail
      ownerId={ownerId}
      markerId={markerId}
      writable={writeAccess.ok}
    />
  );
}
