'use client';
import {
  useEffect,
  useLayoutEffect,
  useState,
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
import { syncDeviceWrites } from '@/lib/offline-write-client';
import { revealOfflineContent } from '@/lib/offline-device';
import { workoutTitle } from '@/lib/workout-title';
import type { OfflineSnapshot } from '@/contracts/offline';
import type { NutritionDay } from '@/contracts/nutrition';
function OfflineRouteContent() {
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
    if (state.bundle) revealOfflineContent(state.bundle.fence);
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
    const saved = snapshot?.diary.find((day) => day.date === date);
    const day: NutritionDay | null = saved
      ? {
          ...saved,
          meals: saved.meals.map((meal) => ({
            ...meal,
            entries: meal.entries.map(({ key, ...entry }) => ({
              ...entry,
              id: key,
              sourceId: null,
              addedAt: null,
              consumedAt: null,
              editedAt: null,
            })),
          })),
        }
      : null;
    content = (
      <Stack>
        <DiaryView
          date={date}
          day={day}
          privatePhotos
          unavailableSlot={!saved ? unknown : undefined}
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
        {disabled}
      </Stack>
    );
  } else if (pathname === '/measurements') {
    content = <Title order={1}>{m.sectionTitle(pathname)}</Title>;
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
        <Button disabled variant="subtle" mih={44}>
          {workoutMessages.syncRefresh}
        </Button>
        {!snapshot?.workoutDates.includes(date) ? (
          unknown
        ) : (
          <WorkoutDay snapshot={snapshot} date={date} />
        )}
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
  } else if (pathname.startsWith('/workouts/')) {
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
      <Stack>
        <Title order={1}>{m.sectionTitle(pathname)}</Title>
        <Alert>{m.requiresNetwork}</Alert>
      </Stack>
    );
  return (
    <Stack gap="lg">
      <Text size="sm" role="status">
        {m.offline}
      </Text>
      {(pathname === '/workouts' || pathname === '/measurements') && (
        <OfflineWrites
          key={pathname}
          kind={pathname === '/workouts' ? 'workout' : 'measurement'}
        />
      )}
      {state.status === 'checking' || state.status === 'saving' ? (
        <Text role="status">{m.checking}</Text>
      ) : state.error ? (
        <Alert color="red">{m[state.error]}</Alert>
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
  useEffect(interceptOfflineLinks, []);
  useEffect(() => {
    const reconnect = async () => {
      await getOfflineController().activate(true, true);
      await syncDeviceWrites().catch(() => {});
      location.reload();
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, []);
  return (
    <ApplicationShellFrame
      role="OWNER"
      demo={false}
      pathname={url?.pathname ?? '/'}
      brandSrc={brandSrc}
      logoutDisabled={!navigator.onLine}
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
}: {
  children: ReactNode;
  role: string;
}) {
  const [offline, setOffline] = useState(false);
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    const lost = () => {
      setOffline(true);
    };
    const connected = () => {
      if (!offline) return;
      setReturning(true);
      void getOfflineController()
        .activate(true, true)
        .then(() => {
          // Genuine server authorization supplies the returned route after verification.
          location.reload();
        });
    };
    window.addEventListener('offline', lost);
    window.addEventListener('online', connected);
    return () => {
      window.removeEventListener('offline', lost);
      window.removeEventListener('online', connected);
    };
  }, [offline]);
  useEffect(() => (offline ? interceptOfflineLinks() : undefined), [offline]);
  if (!offline) return children;
  if (returning) return <Text role="status">{m.checking}</Text>;
  return role === 'OWNER' ? (
    <OfflineRouteContent />
  ) : (
    <Alert>{m.requiresNetwork}</Alert>
  );
}
