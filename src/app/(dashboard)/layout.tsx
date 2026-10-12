import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { OfflineLifecycle } from '@/features/offline';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  return (
    <>
      <OfflineLifecycle role={session.user.role} />
      <ApplicationShell
        role={session.user.role}
        demo={readServerEnv().DEMO_MODE === 'true'}
      >
        <ContentLayout>{children}</ContentLayout>
      </ApplicationShell>
    </>
  );
}
