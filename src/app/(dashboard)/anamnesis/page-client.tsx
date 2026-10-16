'use client';
import { AnamnesisWorkspace } from '@/features/anamnesis';
import { useReadContext } from '@/lib/client-session';
export function AnamnesisPage() {
  const context = useReadContext();
  return (
    <AnamnesisWorkspace
      ownerId={context.ownerId}
      writable={context.role === 'OWNER'}
    />
  );
}
