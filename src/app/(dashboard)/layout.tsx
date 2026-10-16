import { ReadNavigation } from './read-navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { OfflineRouteCapture } from './offline-route-capture';
import { PrivateReadWorkspace } from '@/app/read-workspace';
import { readContext } from '@/server/read-context';
import { OfflineLifecycle } from '@/features/offline';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const initialContext = await readContext(await headers()).catch(() => null);
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
          <PrivateReadWorkspace initialContext={initialContext}>
            {children}
          </PrivateReadWorkspace>
        </ContentLayout>
      </ApplicationShell>
    </>
  );
}
