'use client';
import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { dateInTimezone } from '@/contracts/nutrition-sync-dates';
import {
  Accordion,
  Alert,
  Anchor,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from '@mantine/core';
import type { AnalyticsChange } from '@/contracts/analytics';
import { analyticsMessages as m } from './messages';
import { display, signed } from './display';
export function Details({
  label = m.details,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <Accordion variant="default">
      <Accordion.Item value="details">
        <Accordion.Control>{label}</Accordion.Control>
        <Accordion.Panel>{children}</Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
export function BlockError() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Alert color="red">
      <Stack gap="xs">
        <Text>{m.blockError}</Text>
        <Button
          variant="default"
          loading={pending}
          onClick={() => startTransition(() => router.refresh())}
          mih={44}
        >
          {m.retry}
        </Button>
      </Stack>
    </Alert>
  );
}
export function Comparison({
  change,
  unit,
  failed = false,
}: {
  change: AnalyticsChange | null;
  unit: string;
  failed?: boolean;
}) {
  if (!change && !failed) return null;
  return change ? (
    <Text size="sm" fw={500}>
      {signed(change.delta)} {unit}
      {change.percent !== null ? ` (${signed(change.percent)}%)` : ''}{' '}
      {m.vsPrevious}
    </Text>
  ) : (
    <Text size="sm" c="dimmed">
      {failed ? m.comparisonFailed : m.comparisonMissing}
    </Text>
  );
}
export function Freshness({
  updatedAt,
  timezone,
  today,
  canSync,
}: {
  updatedAt: string | null;
  timezone: string;
  today: string;
  canSync: boolean;
}) {
  const stale =
    updatedAt !== null &&
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(dateInTimezone(new Date(updatedAt), timezone))) /
      86400000 >=
      2;
  return (
    <Group gap="sm">
      <Text size="sm" c={stale ? 'orange' : 'dimmed'}>
        {updatedAt
          ? `${stale ? m.stale : m.updated}: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(updatedAt))}`
          : m.freshnessUnknown}
      </Text>
      {canSync && (
        <Anchor component={Link} href="/settings#sync" size="sm">
          {m.syncLink}
        </Anchor>
      )}
    </Group>
  );
}
export function ChartTooltip({
  date,
  value,
  unit,
  status,
  source,
}: {
  date: string;
  value: string | null;
  unit: string;
  status?: string;
  source?: string;
}) {
  return (
    <Paper withBorder p="sm">
      <Stack gap={4}>
        <Text fw={600}>{date}</Text>
        <Text>
          {display(value)} {unit}
        </Text>
        {status && <Text size="sm">{status}</Text>}
        {source && <Text size="sm">{source}</Text>}
      </Stack>
    </Paper>
  );
}
