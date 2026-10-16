import { ReadNavigation } from './read-navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { OfflineRouteCapture } from './offline-route-capture';
import { PrivateReadWorkspace } from '@/app/read-workspace';
import { readSettings } from '@/server/read-settings';
import { readContext } from '@/server/read-context';
import { OfflineLifecycle } from '@/features/offline';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const initialContext = await readContext(await headers()).catch(
    () => undefined,
  );
  const initialHref = (await headers()).get('x-tempo-read-route') ?? undefined;
  const initialSettings =
    initialHref === '/settings' && initialContext?.role === 'OWNER'
      ? await readSettings(await headers(), initialContext.ownerId).catch(
          () => undefined,
        )
      : undefined;
  return (
    <>
      <ReadNavigation />
      <OfflineLifecycle role={session.user.role} />
      <OfflineRouteCapture role={session.user.role} />
      <ApplicationShell
        initialHref={initialHref}
        role={session.user.role}
        demo={readServerEnv().DEMO_MODE === 'true'}
      >
        <ContentLayout>
          <PrivateReadWorkspace
            initialContext={initialContext}
            initialHref={initialHref}
            initialSettings={initialSettings}
            initialRole={session.user.role}
            initialReaderId={session.user.id}
          >
            {children}
          </PrivateReadWorkspace>
        </ContentLayout>
      </ApplicationShell>
    </>
  );
}
