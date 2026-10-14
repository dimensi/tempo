import { headers } from 'next/headers';
import { authorize, requireSession } from '@/server/auth/guards';
import { getAccessibleOwnerId } from '@/server/access/owner';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { DocumentViewer } from '@/features/anamnesis';

type Props = { params: Promise<{ documentId: string }> };

export function generateMetadata() {
  return { title: m.documents.title };
}

export default async function Page({ params }: Props) {
  const { documentId } = await params;
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
    <DocumentViewer
      ownerId={ownerId}
      documentId={documentId}
      writable={writeAccess.ok}
    />
  );
}
