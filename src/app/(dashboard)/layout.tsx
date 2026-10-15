import { ReadNavigation } from './read-navigation';
import { headers } from 'next/headers';
import { offlineIdentity } from '@/server/offline';
import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { OfflineRouteCapture } from './offline-route-capture';
import { OfflineBoundary } from '@/app/offline-application';
import { DeviceWrites } from './device-writes';
import { OfflineLifecycle } from '@/features/offline';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const initialIdentity = await offlineIdentity(
    await headers(),
    new URL('http://localhost/api/offline/identity'),
  ).catch(() => null);
  return (
    <>
      <ReadNavigation />
      <OfflineLifecycle role={session.user.role} />
      <OfflineRouteCapture role={session.user.role} />
      <ApplicationShell
        role={session.user.role}
        demo={readServerEnv().DEMO_MODE === 'true'}
      >
        <ContentLayout>
          <OfflineBoundary
            role={session.user.role}
            initialIdentity={initialIdentity}
          >
            <DeviceWrites role={session.user.role} />
            {children}
          </OfflineBoundary>
        </ContentLayout>
      </ApplicationShell>
    </>
  );
}
