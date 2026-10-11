import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return (
    <ApplicationShell
      role={session.user.role}
      demo={readServerEnv().DEMO_MODE === 'true'}
    >
      {children}
    </ApplicationShell>
  );
}
