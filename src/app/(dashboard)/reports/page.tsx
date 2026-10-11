import { ReportForm } from '@/features/reports';
import { requireSession } from '@/server/auth/guards';
export const metadata = { title: 'Отчёты' };
export default async function Page() {
  const session = await requireSession();
  return (
    <ReportForm
      ownerId={session.user.role === 'OWNER' ? session.user.id : null}
    />
  );
}
