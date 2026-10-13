import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { OfflineRouteCapture } from './offline-route-capture';
import { OfflineBoundary } from '@/app/offline-application';
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
      <OfflineRouteCapture role={session.user.role} />
      <ApplicationShell
        role={session.user.role}
        demo={readServerEnv().DEMO_MODE === 'true'}
      >
        <ContentLayout>
          <OfflineBoundary role={session.user.role}>{children}</OfflineBoundary>
        </ContentLayout>
      </ApplicationShell>
    </>
  );
}
