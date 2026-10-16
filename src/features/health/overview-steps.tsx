'use client';
import { useReadResource } from '@/lib/use-read-resource';
import { useReadRefresh } from '@/lib/use-read-refresh';
import { useEffect, useState } from 'react';
import { Alert, Skeleton } from '@mantine/core';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { stepsSummarySchema, type StepsSummary } from '@/contracts/health';
import { StepsPanel } from './steps-panel';
import { healthMessages as m } from './messages';

export function HealthOverviewSteps() {
  const readRefresh = useReadRefresh();
  const [resource, setResource] = useState<{
    data: StepsSummary | null;
    error: number | null;
  }>({ data: null, error: null });
  useEffect(() => {
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      controller?.abort();
      controller = new AbortController();
      const active = controller;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = dateInTimezone(new Date(), timezone);
      const range = { from: shiftDate(today, -6), to: today };

      fetch(`/api/health/steps?from=${range.from}&to=${range.to}`, {
        signal: active.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const data = stepsSummarySchema.parse(await response.json());
          if (data.range.from !== range.from || data.range.to !== range.to)
            throw new Error('500');
          if (!active.signal.aborted) setResource({ data, error: null });
        })
        .catch((error) => {
          if (!active.signal.aborted)
            setResource((previous) => ({
              data: [401, 403].includes(Number(error.message))
                ? null
                : previous.data,
              error:
                previous.data && ![401, 403].includes(Number(error.message))
                  ? null
                  : Number(error.message) || 500,
            }));
        });
      clearTimeout(timer);
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 50);
      timer = setTimeout(refresh, midnight.getTime() - Date.now());
    }
    function visible() {
      if (document.visibilityState === 'visible') refresh();
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [readRefresh]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInTimezone(new Date(), timezone);
  const localRead = useReadResource({
    href: `/api/health/steps?from=${shiftDate(today, -6)}&to=${today}`,
    parse: (value) => stepsSummarySchema.parse(value),
  });
  const current = localRead.data ?? resource.data;
  if (resource.error && !current)
    return (
      <Alert color={resource.error === 403 ? 'orange' : 'red'} role="alert">
        {resource.error === 403 ? m.forbidden : m.unavailable}
      </Alert>
    );
  return current ? (
    <StepsPanel summary={current} compact />
  ) : (
    <Skeleton height={240} aria-label={m.loading} />
  );
}
