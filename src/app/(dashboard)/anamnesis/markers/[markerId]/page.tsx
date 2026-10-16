'use client';
import { useParams } from 'next/navigation';
import { MarkerDetail } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export default function Page() {
  const { markerId } = useParams<{ markerId: string }>();
  const context = useReadContext();
  return (
    <MarkerDetail
      ownerId={context.ownerId}
      markerId={markerId}
      writable={context.role === 'OWNER'}
    />
  );
}
