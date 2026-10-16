'use client';
import { dateInTimezone, shiftDate } from '@/contracts/nutrition-sync-dates';
import { readResources } from '@/lib/read-descriptors';
import { useReadResource } from '@/lib/use-read-resource';
import { Alert, Button, Skeleton } from '@mantine/core';
import { useEffect, useState } from 'react';
import { healthMessages as m } from './messages';
import { StepsPanel } from './steps-panel';
export function HealthOverviewSteps() {
  const [today, setToday] = useState(() =>
    dateInTimezone(
      new Date(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );
  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 50);
    const timer = setTimeout(
      () =>
        setToday(
          dateInTimezone(
            new Date(),
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
        ),
      midnight.getTime() - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [today]);
  const resource = useReadResource(
    readResources.steps(
      `/api/health/steps?from=${shiftDate(today, -6)}&to=${today}`,
    ),
  );
  if (resource.data) return <StepsPanel summary={resource.data} compact />;
  if (resource.error)
    return (
      <Alert role="alert">
        {m.unavailable}
        <Button variant="subtle" onClick={() => void resource.refresh()}>
          Повторить
        </Button>
      </Alert>
    );
  return <Skeleton height={240} aria-label={m.loading} />;
}
