import { ReportForm } from '@/features/reports';
import { requireSession } from '@/server/auth/guards';
import { headers } from 'next/headers';
import { getAccessibleOwnerId } from '@/server/access/owner';
export const metadata = { title: 'Отчёты' };
export default async function Page() {
  await requireSession();
  return <ReportForm ownerId={await getAccessibleOwnerId(await headers())} />;
}
