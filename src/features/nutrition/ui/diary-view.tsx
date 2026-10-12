'use client';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Accordion,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  meals,
  type NutritionDay,
  type NutritionTotals,
  type SafeMealPhotoView,
} from '@/contracts/nutrition';
import { diaryMessages as m } from './messages';
import {
  displayValue,
  displayIssue,
  entryAmounts,
  noticeableDifferences,
} from './presentation';

export interface DiaryPhoto extends SafeMealPhotoView {
  href: string;
}
export interface DiaryViewProps {
  date: string;
  day: NutritionDay | null;
  photos?: DiaryPhoto[];
  source?: 'demo';
  commentsSlot?: ReactNode;
  navigationSlot?: ReactNode;
  // Coordinator supplies authorized operations; absent operations hide mutation controls.
  photoActions?: {
    remove: (id: string) => Promise<void>;
  };
}

function Totals({
  totals,
  label,
  kind = 'value',
}: {
  totals: NutritionTotals;
  label: string;
  kind?: 'value' | 'delta';
}) {
  return (
    <Stack gap="xs">
      <Text fw={600}>{label}</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {(Object.keys(m.nutrients) as (keyof NutritionTotals)[]).map((key) => (
          <Box key={key}>
            <Text size="sm">{m.nutrients[key]}</Text>
            <Text
              title={totals[key] ?? undefined}
              style={{ overflowWrap: 'anywhere' }}
            >
              {displayValue(
                totals[key],
                key === 'calories' ? 'ккал' : 'г',
                kind,
              )}
            </Text>
          </Box>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function Summary({
  totals,
  knownTotals,
  officialTotals,
  delta,
  showSource = false,
}: {
  totals: NutritionTotals;
  knownTotals: NutritionTotals;
  officialTotals: NutritionTotals;
  delta: NutritionTotals;
  showSource?: boolean;
}) {
  const differences = noticeableDifferences(delta);
  return (
    <Stack gap="sm">
      <Totals totals={totals} label={m.totals} />
      {showSource && <Text size="sm">{m.sourceNote}</Text>}
      {Object.values(totals).some((value) => value === null) && (
        <Alert color="yellow">{m.partial}</Alert>
      )}
      {differences.length > 0 && (
        <Alert
          color="yellow"
          role="alert"
          title={m.mismatch}
          styles={{
            title: { color: 'var(--mantine-color-text)' },
            message: { color: 'var(--mantine-color-text)' },
          }}
        >
          {differences.map((key) => (
            <Text key={key} size="sm">
              {m.nutrients[key]}:{' '}
              {displayValue(
                delta[key],
                key === 'calories' ? 'ккал' : 'г',
                'delta',
              )}
            </Text>
          ))}
        </Alert>
      )}
      <Accordion variant="default">
        <Accordion.Item value="comparison">
          <Accordion.Control>{m.comparison}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Text size="sm">{m.knownNote}</Text>
              <Totals totals={knownTotals} label={m.known} />
              <Totals totals={officialTotals} label={m.official} />
              <Totals totals={delta} label={m.delta} kind="delta" />
              <Text size="sm" c="dimmed">
                {m.roundingNote}
              </Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

export function DiaryView({
  date,
  day,
  photos = [],
  source,
  commentsSlot,
  navigationSlot,
  photoActions,
}: DiaryViewProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  async function mutate(action: () => Promise<void>) {
    setPending(true);
    setError(false);
    try {
      await action();
      setDeleting(null);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Stack gap="lg" style={{ minWidth: 0 }}>
      <Group justify="space-between">
        <Title order={1}>{m.title}</Title>
        {source === 'demo' && <Badge color="orange">{m.demo}</Badge>}
      </Group>
      {navigationSlot}
      {!day ? (
        <Alert>{m.empty}</Alert>
      ) : (
        <Card withBorder component="section" aria-label={m.daySummary}>
          <Summary {...day} showSource />
        </Card>
      )}
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {meals.map((kind) => {
        const meal = day?.meals.find((meal) => meal.kind === kind);
        const mealPhotos = photos.filter(
          (photo) => photo.date === date && photo.daytime === kind,
        );
        return (
          <Card
            key={kind}
            withBorder
            component="section"
            aria-label={m.meals[kind]}
          >
            <Stack>
              <Title order={2}>{m.meals[kind]}</Title>
              {meal &&
                (meal.entries.length > 0 ||
                  noticeableDifferences(meal.delta).length > 0) && (
                  <Summary {...meal} />
                )}
              {!meal?.entries.length && <Text c="dimmed">{m.noEntries}</Text>}
              {meal?.entries.map((entry) => (
                <Card key={entry.id} withBorder>
                  <Stack>
                    <Group>
                      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                        {entry.name}
                      </Text>
                      {entry.kind === 'ai' && <Badge>{m.ai}</Badge>}
                    </Group>
                    <Totals totals={entry.totals} label={m.entryTotals} />
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {entryAmounts(entry).map(([label, value]) => (
                        <Text
                          key={label}
                          size="sm"
                          style={{ overflowWrap: 'anywhere' }}
                        >
                          {label}: {value}
                        </Text>
                      ))}
                    </SimpleGrid>
                    {entry.issues.length > 0 && (
                      <Alert color="yellow" title={m.issues}>
                        <Stack gap="xs">
                          {entry.issues.map((issue, index) => (
                            <Text
                              key={index}
                              size="sm"
                              style={{ overflowWrap: 'anywhere' }}
                            >
                              {displayIssue(issue)}
                            </Text>
                          ))}
                        </Stack>
                      </Alert>
                    )}
                  </Stack>
                </Card>
              ))}
              {mealPhotos.length > 0 && <Text fw={600}>{m.photos}</Text>}
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {mealPhotos.map((photo) => (
                  <Stack key={photo.id}>
                    <Image
                      src={photo.href}
                      alt={`${m.meals[kind]} — ${photo.source === 'yazio' ? m.automatic : m.manual}`}
                      radius="md"
                      h={220}
                      fit="contain"
                    />
                    <Text size="sm">
                      {photo.source === 'yazio' ? m.automatic : m.manual}
                    </Text>
                    {photo.source === 'manual' && photoActions && (
                      <Button
                        variant="light"
                        color="red"
                        mih={44}
                        disabled={pending}
                        onClick={() => setDeleting(photo.id)}
                      >
                        {m.remove}
                      </Button>
                    )}
                  </Stack>
                ))}
              </SimpleGrid>
            </Stack>
          </Card>
        );
      })}
      {commentsSlot}
      <Modal
        opened={deleting !== null}
        onClose={() => {
          if (!pending) setDeleting(null);
        }}
        title={m.confirm}
        closeButtonProps={{ 'aria-label': m.close }}
      >
        <Group>
          <Button
            variant="default"
            disabled={pending}
            onClick={() => setDeleting(null)}
          >
            {m.cancel}
          </Button>
          <Button
            color="red"
            loading={pending}
            onClick={() => {
              if (deleting && photoActions)
                void mutate(() => photoActions.remove(deleting));
            }}
          >
            {m.remove}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
