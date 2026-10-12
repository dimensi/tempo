'use client';

import { useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
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
import { hasNutritionMealContent } from '@/lib/nutrition-meal-content';
import classes from './diary-view.module.css';
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
    <Stack gap="xs" className={classes.totals}>
      <Text fw={600} size="sm">
        {label}
      </Text>
      <div className={classes.nutrients}>
        {(Object.keys(m.nutrients) as (keyof NutritionTotals)[]).map((key) => (
          <Box key={key} className={classes.nutrient} data-nutrient={key}>
            <Text size="sm">{m.nutrients[key]}</Text>
            <Text
              title={totals[key] ?? undefined}
              className={classes.nutrientValue}
            >
              {displayValue(
                totals[key],
                key === 'calories' ? 'ккал' : 'г',
                kind,
              )}
            </Text>
          </Box>
        ))}
      </div>
    </Stack>
  );
}

function MacroBar({ totals }: { totals: NutritionTotals }) {
  const keys = ['protein', 'fat', 'carbs'] as const;
  if (keys.some((key) => totals[key] === null)) return null;
  const values = keys.map((key) => new Decimal(totals[key]!));
  if (values.some((value) => value.isNegative())) return null;
  const sum = values.reduce(
    (total, value) => total.plus(value),
    new Decimal(0),
  );
  if (sum.isZero()) return null;
  return (
    <Stack gap={6} className={classes.macroSummary}>
      <Text size="xs">{m.macroRatio}</Text>
      <div className={classes.macroBar} role="img" aria-label={m.macroRatio}>
        {keys.map((key, index) => (
          <span
            key={key}
            data-nutrient={key}
            style={{
              width: `${values[index]!.div(sum).times(100).toNumber()}%`,
            }}
          />
        ))}
      </div>
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
      <MacroBar totals={totals} />
      {showSource && <Text size="sm">{m.sourceNote}</Text>}
      {Object.values(totals).some((value) => value === null) && (
        <Text size="sm">{m.partial}</Text>
      )}
      {differences.length > 0 && (
        <Alert
          color="yellow"
          role="alert"
          p="sm"
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
              <Text size="sm">{m.roundingNote}</Text>
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
  const mealSections = meals
    .map((kind) => ({
      kind,
      meal: day?.meals.find((meal) => meal.kind === kind),
      mealPhotos: photos.filter(
        (photo) => photo.date === date && photo.daytime === kind,
      ),
    }))
    .filter(({ meal, mealPhotos }) =>
      hasNutritionMealContent(meal, mealPhotos.length > 0),
    );
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
    <Stack gap="md" className={classes.diary}>
      <Group justify="space-between">
        <Title order={1} size="h2">
          {m.title}
        </Title>
        {source === 'demo' && <Badge color="orange">{m.demo}</Badge>}
      </Group>
      {navigationSlot}
      {!day ? (
        <Alert>{m.empty}</Alert>
      ) : (
        <Card
          withBorder
          radius="md"
          padding="md"
          component="section"
          aria-label={m.daySummary}
        >
          <Summary {...day} showSource />
        </Card>
      )}
      {day && mealSections.length === 0 && <Alert>{m.emptyDay}</Alert>}
      {error && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {mealSections.map(({ kind, meal, mealPhotos }) => {
        return (
          <Card
            key={kind}
            withBorder
            component="section"
            aria-label={m.meals[kind]}
            radius="md"
            padding="md"
            className={classes.meal}
          >
            <Stack>
              <Title order={2} size="h3">
                {m.meals[kind]}
              </Title>
              {meal &&
                (hasNutritionMealContent(meal) ||
                  noticeableDifferences(meal.delta).length > 0) && (
                  <Summary {...meal} />
                )}
              {meal?.entries.map((entry) => (
                <Box key={entry.id} className={classes.entry}>
                  <Stack gap="xs">
                    <Group>
                      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                        {entry.name}
                      </Text>
                      {entry.kind === 'ai' && <Badge>{m.ai}</Badge>}
                    </Group>
                    <Totals totals={entry.totals} label={m.entryTotals} />
                    <Group gap="xs" className={classes.amounts}>
                      {entryAmounts(entry)
                        .filter(([, value]) => value !== m.unknown)
                        .map(([label, value]) => (
                          <Text
                            key={label}
                            size="sm"
                            style={{ overflowWrap: 'anywhere' }}
                          >
                            {label}: {value}
                          </Text>
                        ))}
                    </Group>
                    {entry.issues.length > 0 && (
                      <Alert
                        color="yellow"
                        title={m.issues}
                        styles={{
                          title: { color: 'var(--mantine-color-text)' },
                          message: { color: 'var(--mantine-color-text)' },
                        }}
                      >
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
                </Box>
              ))}
              {mealPhotos.length > 0 && <Text fw={600}>{m.photos}</Text>}
              {mealPhotos.length > 0 && (
                <SimpleGrid
                  cols={{ base: 1, sm: 2 }}
                  className={classes.photos}
                >
                  {mealPhotos.map((photo) => (
                    <Stack key={photo.id}>
                      <Image
                        src={photo.href}
                        alt={`${m.meals[kind]} — ${photo.source === 'yazio' ? m.automatic : m.manual}`}
                        radius="md"
                        mah={260}
                        style={{ aspectRatio: '4 / 3' }}
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
