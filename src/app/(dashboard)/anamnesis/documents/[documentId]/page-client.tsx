'use client';
import { DocumentViewer } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export function DocumentPage({ documentId }: { documentId: string }) {
  const context = useReadContext();
  return (
    <DocumentViewer
      ownerId={context.ownerId}
      documentId={documentId}
      writable={context.role === 'OWNER'}
    />
  );
}
