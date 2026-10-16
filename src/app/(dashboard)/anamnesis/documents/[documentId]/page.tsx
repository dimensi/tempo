'use client';
import { useParams } from 'next/navigation';
import { DocumentViewer } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export default function Page() {
  const { documentId } = useParams<{ documentId: string }>();
  const context = useReadContext();
  return (
    <DocumentViewer
      ownerId={context.ownerId}
      documentId={documentId}
      writable={context.role === 'OWNER'}
    />
  );
}
