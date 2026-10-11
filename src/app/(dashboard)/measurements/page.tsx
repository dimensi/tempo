import { headers } from 'next/headers';
import { requireSession } from '@/server/auth/guards';
import { measurementOwner } from '@/server/measurements';
import { MeasurementsPanel } from '@/features/measurements';
import { measurementMessages as m } from '@/features/measurements';
export const metadata = { title: m.title };
export default async function Page() {
  const session = await requireSession();
  const ownerId = await measurementOwner(
    await headers(),
    session.user.id,
    session.user.role,
  );
  if (!ownerId) return <p>{m.denied}</p>;
  return (
    <MeasurementsPanel
      ownerId={ownerId}
      writable={session.user.role === 'OWNER'}
    />
  );
}
