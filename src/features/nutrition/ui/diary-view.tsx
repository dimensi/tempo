'use client';
import { PageHeader } from '@/components/layout/page-header';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Modal,
  Stack,
  Text,
  Title,
  UnstyledButton,
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
import { MacroEnergyPie } from '@/components/shared/macro-energy-pie';
import { PhotoViewerImage } from './photo-viewer-image';
import {
  displayValue,
  displayIssue,
  entryAmounts,
  noticeableDifferences,
} from './presentation';

export interface DiaryPhoto extends SafeMealPhotoView {
  href: string | null;
}
export interface DiaryViewProps {
  date: string;
  day: NutritionDay | null;
  photos?: DiaryPhoto[];
  source?: 'demo';
  commentsSlot?: ReactNode;
  navigationSlot?: ReactNode;
  unavailableSlot?: ReactNode;
  photosPendingSlot?: ReactNode;
  privatePhotos?: boolean;
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
  label?: string;
  kind?: 'value' | 'delta';
}) {
  return (
    <Stack gap="xs" className={classes.totals}>
      {label && (
        <Text fw={600} size="sm">
          {label}
        </Text>
      )}
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

function Summary({
  totals,
  showSource = false,
}: {
  totals: NutritionTotals;
  showSource?: boolean;
}) {
  return (
    <Stack gap="xs">
      <Totals totals={totals} label={m.totals} />
      <MacroEnergyPie
        totals={totals}
        labels={m.nutrients}
        title={m.macroRatio}
        unavailable={m.macroUnavailable}
        zero={m.zeroEnergy}
        withLegend
        compact
      />
      {showSource && <Text size="sm">{m.sourceNote}</Text>}
      {showSource && Object.values(totals).some((value) => value === null) && (
        <Text size="sm">{m.partial}</Text>
      )}
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
  unavailableSlot,
  photosPendingSlot,
  privatePhotos = false,
  photoActions,
}: DiaryViewProps) {
  const [viewing, setViewing] = useState<string | null>(null);
  const viewingPhoto = photos.find(
    (photo) => photo.id === viewing && photo.date === date,
  );
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
        <PageHeader>{m.title}</PageHeader>
        {source === 'demo' && <Badge color="orange">{m.demo}</Badge>}
      </Group>
      {navigationSlot}
      {!day ? (
        (unavailableSlot ?? (!photosPendingSlot && <Alert>{m.empty}</Alert>))
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
      {day && mealSections.length === 0 && !photosPendingSlot && (
        <Alert>{m.emptyDay}</Alert>
      )}
      {photosPendingSlot}
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
              <div
                className={classes.mealHeader}
                data-has-photo={mealPhotos.length > 0 || undefined}
              >
                {mealPhotos.length > 0 && (
                  <Stack gap="sm" className={classes.photos}>
                    {mealPhotos.map((photo) => (
                      <Stack key={photo.id}>
                        {photo.href ? (
                          <UnstyledButton
                            className={classes.photoOpen}
                            aria-label={`${m.enlargePhoto}: ${m.meals[kind]} — ${photo.source === 'yazio' ? m.automatic : m.manual}`}
                            onClick={() => setViewing(photo.id)}
                          >
                            <Image
                              src={photo.href}
                              alt={`${m.meals[kind]} — ${photo.source === 'yazio' ? m.automatic : m.manual}`}
                              radius="md"
                              mah={260}
                              style={{ aspectRatio: '4 / 3' }}
                              fit="contain"
                            />
                          </UnstyledButton>
                        ) : (
                          <Text role="status">{m.photoNotSaved}</Text>
                        )}
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
                  </Stack>
                )}
                {meal &&
                  (hasNutritionMealContent(meal) ||
                    noticeableDifferences(meal.delta).length > 0) && (
                    <Summary {...meal} />
                  )}
              </div>
              {meal?.entries.map((entry) => (
                <Box key={entry.id} className={classes.entry}>
                  <Stack gap="xs">
                    <Group>
                      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                        {entry.name}
                      </Text>
                      {entry.kind === 'ai' && <Badge>{m.ai}</Badge>}
                    </Group>
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
                    <Totals totals={entry.totals} />
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
            </Stack>
          </Card>
        );
      })}
      {commentsSlot}
      <Modal
        fullScreen
        removeScrollProps={{ allowPinchZoom: true }}
        opened={Boolean(viewingPhoto)}
        onClose={() => setViewing(null)}
        title={m.photoViewer}
        returnFocus
        trapFocus
        closeButtonProps={{ 'aria-label': m.closePhoto, size: 44 }}
      >
        {viewingPhoto?.href && (
          <div data-offline-private={privatePhotos || undefined}>
            <PhotoViewerImage
              key={viewingPhoto.id}
              src={viewingPhoto.href}
              alt={`${m.meals[viewingPhoto.daytime]} — ${viewingPhoto.source === 'yazio' ? m.automatic : m.manual}`}
            />
          </div>
        )}
      </Modal>
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
