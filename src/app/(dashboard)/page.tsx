import { requireSession } from '@/server/auth/guards';
import { Overview } from '@/features/overview';
export const metadata = { title: 'Обзор' };
export default async function Page() {
  await requireSession();
  return <Overview />;
}
