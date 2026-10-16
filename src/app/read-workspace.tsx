'use client';
import type { ReadSettings } from '@/contracts/read-settings';
import { SettingsReadView } from './(dashboard)/settings/read-view';
import { LoginForm } from '@/components/shared/login-form';
import { hasPendingLogout, finishPendingLogout } from '@/lib/local-logout';
import {
  Activity,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Button, Group, Text } from '@mantine/core';
import { readContextSchema, type ReadContext } from '@/contracts/read-context';
import { clientReads } from '@/lib/client-read';
import { useReadResource } from '@/lib/use-read-resource';
import { getOfflineController } from '@/lib/offline-controller';
import {
  hasMutationIntent,
  subscribeOfflineBlocked,
  revealOfflineContent,
  concealOfflineContent,
  isOfflinePageRestorePending,
  purgeOfflineDevice,
} from '@/lib/offline-device';
import {
  ReadLocationProvider,
  useReadLocation,
  isWorkspaceRoute,
  interceptReadLinks,
  navigateWorkspace,
} from '@/lib/workspace-navigation';
import { installReadNavigation } from '@/components/shared/read-link';
import { ReadWorkspaceRoute } from './read-workspace-routes';
import { installSnapshotReads } from './snapshot-reads';
import { readWorkspaceMessages as m } from '@/config/read-workspace';

export function PrivateReadWorkspace({
  initialContext,
  initialHref,
  initialSettings,
  initialRole,
  initialReaderId,
  children,
}: {
  initialContext?: ReadContext | null;
  initialHref?: string;
  initialSettings?: ReadSettings;
  initialRole?: string;
  initialReaderId?: string;
  children?: ReactNode;
}) {
  const href = useReadLocation(initialHref);
  const publicSettings =
    new URL(href || '/', 'https://tempo.local').pathname === '/settings' &&
    initialRole === 'TRAINER';
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const context = useReadResource(
    {
      href: publicSettings ? undefined : '/api/read/context',
      parse: (value) => readContextSchema.parse(value),
    },
    initialContext ?? undefined,
  );
  const [retainedContext, setRetainedContext] = useState(
    initialContext ?? undefined,
  );
  const refreshContext = context.refresh;
  const [denied, setDenied] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [actionError, setActionError] = useState(false);
  const logoutSeen = useRef(false);
  const accessDenied = useRef(false);
  const authorizedPartition = useRef(initialContext?.partition);
  const privateRoot = useRef<HTMLDivElement>(null);
  const [routes, setRoutes] = useState<string[]>(
    initialHref && initialContext ? [initialHref] : [],
  );
  const positions = useRef(new Map<string, number>());
  const currentHref = useRef(href);
  useEffect(() => {
    const stopLinks = interceptReadLinks();
    const stopNavigation = installReadNavigation(navigateWorkspace);
    const recheck = () => {
      void refreshContext();
    };
    window.addEventListener('tempo:read-access-recheck', recheck);
    const blocked = () => {
      concealOfflineContent();
      setDenied(true);
      if (controller.getSnapshot().error === 'denied')
        accessDenied.current = true;
      setLoggedOut(hasPendingLogout());
      if (hasPendingLogout()) logoutSeen.current = true;
      if (!hasMutationIntent() || hasPendingLogout()) {
        setRoutes([]);
        positions.current.clear();
      }
      if (
        !accessDenied.current &&
        !hasMutationIntent() &&
        !hasPendingLogout() &&
        navigator.onLine
      )
        queueMicrotask(() => {
          void refreshContext();
        });
    };
    const confirmedDenied = () => {
      accessDenied.current = true;
      blocked();
    };
    const stopBlocked = subscribeOfflineBlocked(blocked);
    const permit = () => {
      if (
        accessDenied.current ||
        logoutSeen.current ||
        hasPendingLogout() ||
        hasMutationIntent()
      )
        return;
      const resource = clientReads.snapshot('/api/read/context');
      if (!resource.data) return;
      const parsed = readContextSchema.safeParse(JSON.parse(resource.data));
      if (!parsed.success) return;
      const context = parsed.data;
      const bundle = controller.getSnapshot().bundle;
      if (
        bundle &&
        (context.partition !== bundle.snapshot.partition ||
          context.connectionGeneration !== bundle.snapshot.connectionGeneration)
      )
        return;
      if (!authorizedPartition.current)
        authorizedPartition.current = context.partition;
      if (
        resource.source === 'network' &&
        authorizedPartition.current === context.partition
      ) {
        document.documentElement.removeAttribute('data-read-blocked');
        setDenied(false);
        if (
          !bundle &&
          ['disabled', 'error'].includes(controller.getSnapshot().status)
        )
          void controller.activate(navigator.onLine, true);
      }
    };
    const stopPermit = clientReads.subscribe('/api/read/context', permit);

    if (hasPendingLogout()) blocked();
    const finishLogout = () => {
      if (hasPendingLogout()) void finishPendingLogout();
    };
    window.addEventListener('online', finishLogout);
    finishLogout();
    const error = () => setActionError(true);
    window.addEventListener('tempo:read-access-denied', confirmedDenied);
    window.addEventListener('tempo:action-unavailable', error);
    return () => {
      stopLinks();
      stopNavigation();
      window.removeEventListener('tempo:read-access-recheck', recheck);
      stopBlocked();
      stopPermit();
      window.removeEventListener('online', finishLogout);
      window.removeEventListener('tempo:read-access-denied', confirmedDenied);
      window.removeEventListener('tempo:action-unavailable', error);
    };
  }, [controller, refreshContext]);
  useEffect(() => installSnapshotReads(), []);
  useLayoutEffect(() => {
    if (
      loggedOut ||
      hasPendingLogout() ||
      !context.data ||
      denied ||
      !privateRoot.current
    )
      return;
    if (
      initialContext === null ||
      (initialReaderId && context.data.readerId !== initialReaderId) ||
      (initialRole && context.data.role !== initialRole) ||
      (authorizedPartition.current &&
        context.data.partition !== authorizedPartition.current)
    ) {
      concealOfflineContent();
      void purgeOfflineDevice().catch(() => {});
      return;
    }
    if (isOfflinePageRestorePending() && state.status === 'checking') return;
    const snapshot = state.bundle?.snapshot;
    if (
      snapshot &&
      (snapshot.partition !== context.data.partition ||
        snapshot.connectionGeneration !== context.data.connectionGeneration ||
        snapshot.role !== context.data.role)
    ) {
      concealOfflineContent();
      void purgeOfflineDevice().catch(() => {});
      return;
    }
    if (state.bundle) revealOfflineContent(state.bundle.fence);
    else if (initialContext && !isOfflinePageRestorePending()) {
      privateRoot.current.hidden = false;
      for (const portal of document.querySelectorAll<HTMLElement>(
        '[data-portal]',
      ))
        portal.hidden = false;
    }
  }, [
    context.data,
    denied,
    loggedOut,
    state,
    initialContext,
    initialReaderId,
    initialRole,
  ]);
  useLayoutEffect(() => {
    if (
      !href ||
      !isWorkspaceRoute(new URL(href, 'https://tempo.local').pathname)
    )
      return;
    currentHref.current = href;
    const top = positions.current.get(href);
    if (top !== undefined) window.scrollTo(0, top);
  }, [href]);
  useEffect(() => {
    const remember = () =>
      positions.current.set(currentHref.current, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('tempo:read-before-navigation', remember);
    return () => {
      window.removeEventListener('scroll', remember);
      window.removeEventListener('tempo:read-before-navigation', remember);
    };
  }, []);
  if (context.data && retainedContext !== context.data && !denied)
    setRetainedContext(context.data);
  const reader = context.data ?? retainedContext;
  const managed =
    !publicSettings &&
    !!href &&
    isWorkspaceRoute(new URL(href, 'https://tempo.local').pathname);
  if (managed && !denied && !routes.includes(href))
    setRoutes([...routes, href]);
  return (
    <>
      {initialContext && (
        <script
          dangerouslySetInnerHTML={{
            __html: `try { if (localStorage.getItem("tempo:logout-pending") === "true" || Object.keys(localStorage).some(k => k.startsWith("yazio.offline.intent:"))) document.documentElement.setAttribute("data-read-blocked", ""); } catch { document.documentElement.setAttribute("data-read-blocked", ""); }`,
          }}
        />
      )}
      {loggedOut && (
        <main>
          <LoginForm />
        </main>
      )}
      {denied && !loggedOut && !publicSettings && (
        <main>
          <Group role="alert">
            <Text>{m.denied}</Text>
            <a href="/login">{m.login}</a>
          </Group>
        </main>
      )}
      {publicSettings && (
        <main>
          <SettingsReadView ownerId={null} owner={false} />
        </main>
      )}
      {actionError && (
        <Group role="status">
          <Text size="sm">{m.actionUnavailable}</Text>
          <Button variant="subtle" onClick={() => setActionError(false)}>
            ×
          </Button>
        </Group>
      )}
      <div ref={privateRoot} data-offline-private hidden={!initialContext}>
        {reader &&
          routes.map((route) => (
            <Activity
              key={`${reader.partition}:${route}`}
              mode={managed && route === href ? 'visible' : 'hidden'}
            >
              <main data-read-route={route}>
                <ReadLocationProvider href={route}>
                  <ReadWorkspaceRoute
                    initialSettings={
                      route === '/settings' ? initialSettings : undefined
                    }
                    href={route}
                    context={reader}
                  />
                </ReadLocationProvider>
              </main>
            </Activity>
          ))}
        <Activity mode={managed || publicSettings ? 'hidden' : 'visible'}>
          <main>{children}</main>
        </Activity>
      </div>
    </>
  );
}
