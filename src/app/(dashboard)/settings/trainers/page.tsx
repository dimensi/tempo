import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth/guards';
export default async function TrainersPage() {
  const session = await requireSession();
  if (session.user.role !== 'OWNER') redirect('/');
  redirect('/settings#trainers');
}
