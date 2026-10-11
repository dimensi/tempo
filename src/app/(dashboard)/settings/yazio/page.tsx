import { redirect } from 'next/navigation';
import { requireSession } from '@/server/auth/guards';
export default async function YazioSettingsPage() {
  await requireSession();
  redirect('/settings#connection');
}
