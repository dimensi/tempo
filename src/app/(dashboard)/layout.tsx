import { ApplicationShell } from '@/components/layout/application-shell';
import { ContentLayout } from '@/components/layout/content-layout';
import { ClientSession } from '@/lib/client-session';
import { requireSession } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
import { readContext } from '@/server/read-context';
import { headers } from 'next/headers';
export const dynamic = 'force-dynamic';
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const context = await readContext(await headers());
  if (!context) return null;
  return (
    <ClientSession initial={context}>
      <ApplicationShell
        role={session.user.role}
        demo={readServerEnv().DEMO_MODE === 'true'}
      >
        <ContentLayout>
          <main>{children}</main>
        </ContentLayout>
      </ApplicationShell>
    </ClientSession>
  );
}
