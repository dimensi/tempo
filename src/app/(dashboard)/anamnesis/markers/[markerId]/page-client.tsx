'use client';
import { MarkerDetail } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export function MarkerPage({ markerId }: { markerId: string }) {
  const context = useReadContext();
  return (
    <MarkerDetail
      ownerId={context.ownerId}
      markerId={markerId}
      writable={context.role === 'OWNER'}
    />
  );
}
