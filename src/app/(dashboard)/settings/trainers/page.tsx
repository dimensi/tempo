import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth/guards';
import { listTrainers } from '@/server/access/trainers';
import { TrainerSettings } from '@/features/trainer';
export default async function TrainersPage() {
  const session = await requireSession();
  if (session.user.role !== 'OWNER') redirect('/');
  const trainers = await listTrainers(await headers(), session.user.id);
  return (
    <TrainerSettings ownerId={session.user.id} initialTrainers={trainers} />
  );
}
