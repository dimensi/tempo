'use client';
import { useParams } from 'next/navigation';
import { Alert } from '@mantine/core';
import { ReviewEditor, anamnesisMessages } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export default function Page() {
  const { documentId } = useParams<{ documentId: string }>();
  const context = useReadContext();
  if (context.role !== 'OWNER')
    return <Alert>{anamnesisMessages.reviews.ownerOnly}</Alert>;
  return (
    <ReviewEditor
      key={`${context.partition}:${documentId}`}
      ownerId={context.ownerId}
      documentId={documentId}
    />
  );
}
