'use client';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  FileButton,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  meals,
  type MealKind,
  type NutritionDay,
  type NutritionTotals,
  type SafeMealPhotoView,
} from '@/contracts/nutrition';
import { diaryMessages as m } from './messages';
import { displayValue, displayIssue, entryAmounts } from './presentation';

export interface DiaryPhoto extends SafeMealPhotoView {
  href: string;
}
export interface DiaryViewProps {
  date: string;
  day: NutritionDay | null;
  photos?: DiaryPhoto[];
  source?: 'demo';
  commentsSlot?: ReactNode;
  // Coordinator supplies authorized operations; absent operations hide mutation controls.
  photoActions?: {
    upload: (date: string, meal: MealKind, file: File) => Promise<void>;
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
            <Text size="sm" c="dimmed">
              {m.nutrients[key]}
            </Text>
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

export function DiaryView({
  date,
  day,
  photos = [],
  source,
  commentsSlot,
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
      <Box component="form" action="/diary" method="get">
        <Group align="end">
          <TextInput
            type="date"
            name="date"
            label={m.date}
            defaultValue={date}
            required
            style={{ flex: '1 1 180px' }}
          />
          <Button type="submit" mih={44}>
            {m.open}
          </Button>
        </Group>
      </Box>
      {!day ? (
        <Alert>{m.empty}</Alert>
      ) : (
        <Card withBorder>
          <Stack>
            <Totals totals={day.totals} label={m.totals} />
            {Object.values(day.totals).some((value) => value === null) && (
              <Alert color="yellow">{m.partial}</Alert>
            )}
            <Totals totals={day.knownTotals} label={m.known} />
            <Totals totals={day.officialTotals} label={m.official} />
            <Totals totals={day.delta} label={m.delta} kind="delta" />
            <Text size="sm" c="dimmed">
              {m.roundingNote}
            </Text>
          </Stack>
        </Card>
      )}
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {meals.map((kind) => {
        const meal = day?.meals.find((meal) => meal.kind === kind);
        return (
          <Card
            key={kind}
            withBorder
            component="section"
            aria-label={m.meals[kind]}
          >
            <Stack>
              <Title order={2}>{m.meals[kind]}</Title>
              {meal && (
                <>
                  <Totals totals={meal.totals} label={m.totals} />
                  <Totals totals={meal.knownTotals} label={m.known} />
                  <Totals totals={meal.officialTotals} label={m.official} />
                  <Totals totals={meal.delta} label={m.delta} kind="delta" />
                </>
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
                    <Totals totals={entry.totals} label={m.totals} />
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
              <Text fw={600}>{m.photos}</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {photos
                  .filter(
                    (photo) => photo.date === date && photo.daytime === kind,
                  )
                  .map((photo) => (
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
              {photoActions && (
                <FileButton
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(file) => {
                    if (file)
                      void mutate(() => photoActions.upload(date, kind, file));
                  }}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="light"
                      mih={44}
                      disabled={pending}
                    >
                      {m.upload}
                    </Button>
                  )}
                </FileButton>
              )}
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
