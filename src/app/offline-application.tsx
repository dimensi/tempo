'use client';
import {
  Activity,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { ApplicationShellFrame } from '@/components/layout/application-shell-frame';
import { ContentLayout } from '@/components/layout/content-layout';
import { DateNavigation } from '@/components/shared/date-navigation';
import { browserToday } from '@/components/shared/date-navigation-dates';
import {
  DiaryView,
  diaryMessages,
  type DiaryPhoto,
} from '@/features/nutrition/read';
import { WorkoutReadContent, workoutMessages } from '@/features/workouts/read';
import {
  OfflineWrites,
  getOfflineController,
  offlineMessages as m,
  interceptOfflineLinks,
  offlineNavigate,
  useOfflineLocation,
} from '@/features/offline';
import {
  OfflineSection,
  OfflineComments,
  OfflineVideos,
  OfflineFiles,
} from './offline-sections';
import { savedDiaryDay } from './offline-model';
import { reconnectReads } from '@/lib/offline-reconnect';
import { isOfflineRoute } from '@/lib/offline-routing';
import { useReadOnline } from '@/lib/use-read-online';
import { canRetainLiveRead } from '@/lib/live-read-scope';
import { hasSavedReadRoute } from '@/lib/saved-read-route';
import { hasSavedMedicalRoute } from '@/lib/client-read';
import { revealOfflineContent } from '@/lib/offline-device';
import { workoutTitle } from '@/lib/workout-title';
import {
  offlineIdentitySchema,
  type OfflineIdentity,
  type OfflineSnapshot,
} from '@/contracts/offline';
function OfflineRouteContent({ showStatus = true }: { showStatus?: boolean }) {
  const url = useOfflineLocation();
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const [photoCopy, setPhotoCopy] = useState<{
    bundle: typeof state.bundle;
    photos: DiaryPhoto[];
  } | null>(null);
  const photos =
    state.bundle && photoCopy?.bundle === state.bundle
      ? photoCopy.photos.filter((photo) =>
          state.bundle!.snapshot.photos.items.some(
            (current) => current.id === photo.id,
          ),
        )
      : [];
  useLayoutEffect(() => {
    // A BFCache restore starts from synchronously concealed DOM. Keep it
    // concealed while the retained bundle's identity is being revalidated.
    if (state.bundle && state.status !== 'checking')
      revealOfflineContent(state.bundle.fence);
  }, [state]);
  useEffect(() => {
    const byId = new Map(state.photos.map((photo) => [photo.id, photo.bytes]));
    const urls: string[] = [];
    const nextPhotos = (
      state.bundle?.snapshot.photos.items ?? []
    ).flatMap<DiaryPhoto>((photo) => {
      const blob = byId.get(photo.id);
      if (!blob) return [{ ...photo, href: null }];
      const href = URL.createObjectURL(blob);
      urls.push(href);
      return [{ ...photo, href }];
    });
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setPhotoCopy({ bundle: state.bundle, photos: nextPhotos });
    });
    return () => {
      active = false;
      urls.forEach((href) => URL.revokeObjectURL(href));
    };
  }, [state.bundle, state.photos]);
  if (!url) return null;
  const pathname = url.pathname;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '')
    ? url.searchParams.get('date')!
    : browserToday();
  const snapshot = state.bundle?.snapshot;
  const unknown = <Alert role="status">{m.unknown}</Alert>;
  const disabled = (
    <Text size="sm" c="dimmed">
      {m.readonly}
    </Text>
  );
  let content: ReactNode = unknown;
  if (pathname === '/diary') {
    const day = savedDiaryDay(snapshot, date);
    content = (
      <Stack>
        <DiaryView
          date={date}
          day={day}
          privatePhotos
          unavailableSlot={!day ? unknown : undefined}
          photos={photos.filter((photo) => photo.date === date)}
          navigationSlot={
            <Stack gap="sm">
              <DateNavigation
                key={date}
                date={date}
                labels={diaryMessages}
                onSelect={(value) => offlineNavigate(`/diary?date=${value}`)}
              />
              <Button disabled mih={44}>
                {diaryMessages.refreshDay}
              </Button>
            </Stack>
          }
        />
        {snapshot?.photos.items.some(
          (photo) =>
            photo.date === date &&
            !photos.some((saved) => saved.id === photo.id && saved.href),
        ) && <Text>{m.noPhoto}</Text>}
        {snapshot && day && (
          <OfflineComments snapshot={snapshot} target={`/diary?date=${date}`} />
        )}
        {disabled}
      </Stack>
    );
  } else if (pathname === '/workouts') {
    content = (
      <Stack>
        <Group justify="space-between">
          <Title order={1} size="h2">
            {workoutMessages.title}
          </Title>
        </Group>
        <DateNavigation
          key={date}
          date={date}
          labels={workoutMessages.dateNavigation}
          onSelect={(value) => offlineNavigate(`/workouts?date=${value}`)}
        />
        <Button
          component="a"
          href="/workouts/catalog"
          variant="subtle"
          mih={44}
        >
          {m.cachedCatalog}
        </Button>
        <Button disabled variant="subtle" mih={44}>
          {workoutMessages.syncRefresh}
        </Button>
        {!snapshot?.workoutDates.includes(date) ? (
          unknown
        ) : (
          <WorkoutDay snapshot={snapshot} date={date} />
        )}
        <OfflineFiles kind="video" />
      </Stack>
    );
  } else if (
    /\/(?:edit|results)$/.test(pathname) ||
    /\/workouts\/(?:new|sessions\/new)$/.test(pathname)
  ) {
    content = (
      <Stack>
        <Title order={1}>{workoutMessages.title}</Title>
        <Alert>{m.requiresNetwork}</Alert>
        {disabled}
      </Stack>
    );
  } else if (
    pathname.startsWith('/workouts/') &&
    pathname !== '/workouts/catalog'
  ) {
    const plan = snapshot?.plannedWorkouts.find(
      (item) => item.href === pathname,
    );
    const session = snapshot?.workoutSessions.find(
      (item) => item.href === pathname,
    );
    const native = snapshot?.nativeTrainings.find(
      (item) => item.href === pathname,
    );
    const fact = snapshot?.transformMateFacts.find(
      (item) => item.href === pathname,
    );
    const item = plan ?? session ?? native ?? fact;
    content =
      item && snapshot ? (
        <Stack>
          <Group justify="space-between">
            <Title order={1} size="h2">
              {workoutTitle(item.title, item.date)}
            </Title>
            <Button
              component="a"
              href={`/workouts?date=${item.date}`}
              variant="subtle"
              mih={44}
            >
              {workoutMessages.back}
            </Button>
          </Group>
          <Group>
            <Button disabled variant="subtle" mih={44}>
              {workoutMessages.editShort}
            </Button>
            <Button disabled variant="subtle" mih={44}>
              {workoutMessages.recordShort}
            </Button>
            <Button disabled variant="subtle" mih={44}>
              {workoutMessages.copyShort}
            </Button>
            <Button disabled variant="subtle" mih={44}>
              {workoutMessages.deleteShort}
            </Button>
          </Group>
          {disabled}
          {plan && (
            <WorkoutReadContent
              kind="plan"
              description={plan.planDescription}
              exercises={plan.exercises}
              sessions={snapshot.workoutSessions.filter(
                (result) => result.plannedHref === plan.href,
              )}
            />
          )}
          {plan && <LinkedWorkoutFacts snapshot={snapshot} href={plan.href} />}
          {session && (
            <WorkoutReadContent
              kind="session"
              status={session.status}
              exercises={session.exercises}
              snapshot={session.planSnapshot}
              note={session.note}
            />
          )}
          {native && <WorkoutReadContent kind="native" item={native} />}
          {fact && <WorkoutReadContent kind="fact" item={fact} />}
          {session && (
            <>
              <OfflineComments snapshot={snapshot} target={session.href} />
              <OfflineVideos snapshot={snapshot} href={session.href} />
            </>
          )}
        </Stack>
      ) : (
        <Stack>
          <Button
            component="a"
            href={`/workouts?date=${date}`}
            variant="subtle"
            mih={44}
          >
            {workoutMessages.back}
          </Button>
          {unknown}
        </Stack>
      );
  } else
    content = (
      <OfflineSection snapshot={snapshot} url={url} today={browserToday()} />
    );
  return (
    <Stack gap="lg">
      {showStatus && <OfflineReadStatus offlineMode />}
      {state.error && (
        <Alert color="orange">
          {m[state.error]}
          {state.error === 'denied' && <a href="/login">{m.signInAgain}</a>}
        </Alert>
      )}
      {(pathname === '/workouts' || pathname === '/measurements') && (
        <OfflineWrites
          key={pathname}
          kind={pathname === '/workouts' ? 'workout' : 'measurement'}
        />
      )}
      {!snapshot &&
      (state.status === 'checking' || state.status === 'saving') ? (
        <Text role="status">{m.checking}</Text>
      ) : snapshot ? (
        <div data-offline-private hidden>
          {content}
        </div>
      ) : (
        content
      )}
    </Stack>
  );
}
function OfflineReadStatus({ offlineMode = false }: { offlineMode?: boolean }) {
  const online = useReadOnline();
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, []);
  const retry = async () => {
    await reconnectReads();
  };
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text
          size="xs"
          c="dimmed"
          role="status"
          style={
            offlineMode
              ? undefined
              : {
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }
          }
        >
          {!online ? m.networkUnavailable : m.reachable}
          {state.bundle &&
            ` · ${m.saved}: ${new Date(state.bundle.savedAt).toLocaleString('ru-RU')}`}
        </Text>
        {offlineMode && (
          <Button
            size="compact-xs"
            mih={44}
            variant="subtle"
            onClick={() => void retry()}
          >
            {m.retryConnection}
          </Button>
        )}
      </Group>
      {state.bundle && now >= state.bundle.sessionExpiresAt && (
        <Text size="xs" c="dimmed">
          {m.sessionExpired}
        </Text>
      )}
    </Stack>
  );
}

function LinkedWorkoutFacts({
  snapshot,
  href,
}: {
  snapshot: OfflineSnapshot;
  href: string;
}) {
  const renderedNative = new Set<string>();
  return snapshot.transformMateFacts
    .filter((fact) => fact.plannedHref === href)
    .map((fact) => {
      const native = snapshot.nativeTrainings.find(
        (item) => item.href === fact.nativeHref,
      );
      if (native && renderedNative.has(native.href)) return null;
      if (native) renderedNative.add(native.href);
      return (
        <Stack key={fact.key}>
          <Title order={2} size="h3">
            {workoutMessages.remoteActual}
          </Title>
          {native ? (
            <WorkoutReadContent kind="native" item={native} />
          ) : (
            <WorkoutReadContent kind="fact" item={fact} />
          )}
        </Stack>
      );
    });
}
function WorkoutDay({
  snapshot,
  date,
}: {
  snapshot: OfflineSnapshot;
  date: string;
}) {
  const records = [
    ...snapshot.plannedWorkouts
      .filter((item) => item.date === date)
      .map((item) => ({ ...item, kind: 'plan' as const })),
    ...snapshot.workoutSessions
      .filter(
        (item) =>
          item.date === date &&
          !snapshot.plannedWorkouts.some(
            (plan) => plan.href === item.plannedHref,
          ),
      )
      .map((item) => ({ ...item, kind: 'session' as const })),
    ...snapshot.nativeTrainings
      .filter(
        (item) =>
          item.date === date &&
          !snapshot.transformMateFacts.some(
            (fact) =>
              fact.nativeHref === item.href &&
              snapshot.plannedWorkouts.some(
                (plan) => plan.href === fact.plannedHref,
              ),
          ),
      )
      .map((item) => ({ ...item, kind: 'native' as const })),
    ...snapshot.transformMateFacts
      .filter(
        (item) =>
          item.date === date &&
          !snapshot.nativeTrainings.some(
            (native) => native.href === item.nativeHref,
          ) &&
          !snapshot.plannedWorkouts.some(
            (plan) => plan.href === item.plannedHref,
          ),
      )
      .map((item) => ({ ...item, kind: 'fact' as const })),
  ];
  return records.length ? (
    records.map((item) => (
      <Paper withBorder p="md" key={item.key}>
        <Stack>
          <Group justify="space-between">
            <Title order={2}>{workoutTitle(item.title, date)}</Title>
            <Button
              component="a"
              href={`${item.href}?date=${date}`}
              variant="subtle"
              mih={44}
            >
              {workoutMessages.view}
            </Button>
          </Group>
          {item.kind === 'plan' && (
            <WorkoutReadContent
              kind="plan"
              description={item.planDescription}
              exercises={item.exercises}
              sessions={snapshot.workoutSessions.filter(
                (result) => result.plannedHref === item.href,
              )}
            />
          )}
          {item.kind === 'plan' && (
            <LinkedWorkoutFacts snapshot={snapshot} href={item.href} />
          )}
          {item.kind === 'session' && (
            <WorkoutReadContent
              kind="session"
              status={item.status}
              exercises={item.exercises}
              snapshot={item.planSnapshot}
              note={item.note}
            />
          )}
          {item.kind === 'native' && (
            <WorkoutReadContent kind="native" item={item} />
          )}
          {item.kind === 'fact' && (
            <WorkoutReadContent kind="fact" item={item} />
          )}
        </Stack>
      </Paper>
    ))
  ) : (
    <Paper withBorder p="lg">
      <Title order={2}>{workoutMessages.emptyDay}</Title>
    </Paper>
  );
}
export function OfflineApplication({ brandSrc }: { brandSrc: string }) {
  const url = useOfflineLocation();
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useEffect(
    () =>
      interceptOfflineLinks(
        (destination) => {
          const snapshot = controller.getSnapshot().bundle?.snapshot;
          if (snapshot && hasSavedReadRoute(snapshot, destination)) return true;
          return destination.pathname === '/anamnesis' ||
            destination.pathname.startsWith('/anamnesis/')
            ? hasSavedMedicalRoute(destination)
            : false;
        },
        undefined,
        () => {
          const snapshot = controller.getSnapshot().bundle?.snapshot;
          return snapshot
            ? {
                partition: snapshot.partition,
                connectionGeneration: snapshot.connectionGeneration,
                role: snapshot.role,
              }
            : null;
        },
      ),
    [controller],
  );
  useEffect(() => {
    const reconnect = () => {
      void reconnectReads();
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [controller]);
  return (
    <ApplicationShellFrame
      role={state.bundle?.snapshot.role ?? 'OWNER'}
      demo={false}
      pathname={url?.pathname ?? '/'}
      brandSrc={brandSrc}
      logoutDisabled
    >
      <ContentLayout>
        <OfflineRouteContent />
      </ContentLayout>
    </ApplicationShellFrame>
  );
}
export function OfflineBoundary({
  children,
  role,
  initialIdentity,
}: {
  children: ReactNode;
  role: string;
  initialIdentity: OfflineIdentity | null;
}) {
  // The mounted Next screen owns its form state. Connectivity must never replace it.
  const url = useOfflineLocation();
  const [denied, setDenied] = useState(false);
  const verifiedPartition = useRef(initialIdentity?.partition ?? null);
  const verifiedGeneration = useRef(
    initialIdentity?.connectionGeneration ?? null,
  );
  useEffect(() => {
    const blocked = () => setDenied(true);
    let checkingAccess = false;
    const recheck = () => {
      if (checkingAccess || !navigator.onLine) return;
      checkingAccess = true;
      void fetch('/api/offline/identity', {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const identity = offlineIdentitySchema.parse(await response.json());
          if (
            !verifiedPartition.current ||
            !verifiedGeneration.current ||
            !canRetainLiveRead(
              {
                partition: verifiedPartition.current,
                connectionGeneration: verifiedGeneration.current,
                role,
              },
              identity,
            )
          )
            return;
          verifiedGeneration.current = identity.connectionGeneration;
          setDenied(false);
          // Restoring live authorization must not depend on IndexedDB or SW availability.
          void getOfflineController().activate(true, true);
        })
        .catch(() => {})
        .finally(() => {
          checkingAccess = false;
        });
    };
    const verified = getOfflineController().subscribe(() => {
      const state = getOfflineController().getSnapshot();
      if (state.status === 'ready' && state.bundle) {
        const partition = state.bundle.fence.partition;
        if (
          verifiedPartition.current &&
          !canRetainLiveRead(
            {
              partition: verifiedPartition.current,
              connectionGeneration: verifiedGeneration.current ?? '',
              role,
            },
            state.bundle.snapshot,
          )
        ) {
          setDenied(true);
          return;
        }
        verifiedPartition.current = partition;
        verifiedGeneration.current = state.bundle.snapshot.connectionGeneration;
        setDenied(false);
      } else if (state.error === 'denied') setDenied(true);
    });
    window.addEventListener('tempo:read-access-denied', blocked);
    window.addEventListener('tempo:read-access-recheck', recheck);
    window.addEventListener('focus', recheck);
    window.addEventListener('online', recheck);
    return () => {
      verified();
      window.removeEventListener('tempo:read-access-denied', blocked);
      window.removeEventListener('tempo:read-access-recheck', recheck);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('online', recheck);
    };
  }, [role]);
  // Next's layout children can retain their identity across normal navigation.
  // Only an explicitly intercepted history entry belongs to the saved shell.
  const showingSavedRoute = isOfflineRoute(url);
  return (
    <Stack gap={0}>
      <OfflineReadStatus offlineMode={showingSavedRoute} />
      {denied && (
        <Alert>
          {m.denied} <a href="/login">{m.signInAgain}</a>
        </Alert>
      )}
      <div hidden={denied}>
        <Activity mode={showingSavedRoute ? 'hidden' : 'visible'}>
          {children}
        </Activity>
      </div>
      {showingSavedRoute && !denied && ['OWNER', 'TRAINER'].includes(role) && (
        <OfflineRouteContent showStatus={false} />
      )}
    </Stack>
  );
}
