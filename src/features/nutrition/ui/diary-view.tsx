'use client';
import { GoalComparison } from '@/components/shared/goal-comparison';
import type { DailyGoals } from '@/contracts/daily-goals';
import { PageHeader } from '@/components/layout/page-header';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  meals,
  type NutritionDay,
  type NutritionEntry,
  type NutritionTotals,
  type SafeMealPhotoView,
} from '@/contracts/nutrition';
import { diaryMessages as m } from './messages';
import { hasNutritionMealContent } from '@/lib/nutrition-meal-content';
import classes from './diary-view.module.css';
import { MacroEnergyPie } from '@/components/shared/macro-energy-pie';
import { MealPhoto } from './meal-photo';
import { macroEnergyShares, macroKeys } from '@/lib/macro-energy';
import { formatDecimal } from '@/lib/number-display';
import {
  displayValue,
  displayIssue,
  entryAmounts,
  entryQuantity,
  noticeableDifferences,
} from './presentation';

export interface DiaryPhoto extends SafeMealPhotoView {
  href: string | null;
}
export interface DiaryViewProps {
  date: string;
  day: NutritionDay | null;
  goals?: DailyGoals;
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

function Entry({ entry }: { entry: NutritionEntry }) {
  const quantity = entryQuantity(entry);
  const details = entryAmounts(entry).filter(
    ([label]) => label === m.recipe || label === m.estimate,
  );
  return (
    <Box component="li" className={classes.entry}>
      <div className={classes.entryHeading}>
        <Text span fw={600} className={classes.entryName}>
          {entry.name}
        </Text>
        {quantity && (
          <Text span size="sm" c="dimmed">
            {' '}
            · {quantity}
          </Text>
        )}
        {entry.kind === 'ai' && <Badge size="xs">{m.ai}</Badge>}
      </div>
      <div className={classes.entryNutrients}>
        {(Object.keys(m.nutrients) as (keyof NutritionTotals)[]).map((key) => (
          <Text
            span
            size="sm"
            key={key}
            className={classes.nutrientValue}
            data-nutrient={key}
            title={`${m.nutrients[key]}: ${entry.totals[key] ?? m.unknown}`}
          >
            <span className={classes.srOnly}>{m.nutrients[key]}: </span>
            {key !== 'calories' && (
              <span aria-hidden="true">{m.shortNutrients[key]} </span>
            )}
            {displayValue(entry.totals[key], key === 'calories' ? 'ккал' : 'г')}
          </Text>
        ))}
      </div>
      {entry.issues.length > 0 && (
        <Text size="sm" c="dimmed" className={classes.entryIssues}>
          {entry.issues.map(displayIssue).join(' ')}
        </Text>
      )}
      {details.length > 0 && (
        <details className={classes.entryDetails}>
          <summary>{m.details}</summary>
          {details.map(([label, value]) => (
            <Text key={label} size="sm">
              {label}: {value}
            </Text>
          ))}
        </details>
      )}
    </Box>
  );
}

function Summary({
  goal,
  withGoal = false,
  totals,
  showSource = false,
}: {
  totals: NutritionTotals;
  goal?: string | null;
  withGoal?: boolean;
  showSource?: boolean;
}) {
  const shares = macroEnergyShares(totals);
  const hasEnergy = shares?.some(({ percent }) => percent > 0);
  return (
    <Stack gap="xs">
      <div className={classes.summary} data-has-chart={hasEnergy || undefined}>
        {hasEnergy && (
          <div className={classes.summaryChart}>
            <MacroEnergyPie
              totals={totals}
              labels={m.nutrients}
              title={m.macroRatio}
              unavailable={m.macroUnavailable}
              zero={m.zeroEnergy}
              size={88}
              withCaption={false}
            />
          </div>
        )}
        <div className={classes.summaryStats}>
          <Text
            className={classes.summaryCalories}
            data-nutrient="calories"
            title={totals.calories ?? undefined}
          >
            {displayValue(totals.calories, 'ккал')}
          </Text>
          <dl className={classes.summaryMacros}>
            {macroKeys.map((key) => (
              <div key={key} className={classes.summaryMacro}>
                <dt>
                  <span
                    className={classes.swatch}
                    data-nutrient={key}
                    aria-hidden="true"
                  />
                  {m.nutrients[key]}
                </dt>
                <dd>
                  <span
                    className={classes.nutrientValue}
                    data-nutrient={key}
                    title={totals[key] ?? undefined}
                  >
                    {displayValue(totals[key], 'г')}
                  </span>
                  {hasEnergy && (
                    <span className={classes.share}>
                      {formatDecimal(
                        shares!.find((share) => share.key === key)!.percent,
                      )}
                      %
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {!hasEnergy && (
        <Text size="sm" c="dimmed">
          {shares ? m.zeroEnergy : m.macroUnavailable}
        </Text>
      )}
      {withGoal && (
        <GoalComparison
          actual={totals.calories}
          goal={goal ?? null}
          unit="ккал"
          compact
        />
      )}
      {showSource && (
        <Text size="xs" c="dimmed">
          {m.sourceNote}
        </Text>
      )}
      {showSource && Object.values(totals).some((value) => value === null) && (
        <Text size="sm">{m.partial}</Text>
      )}
    </Stack>
  );
}

export function DiaryView({
  date,
  day,
  goals,
  photos = [],
  source,
  commentsSlot,
  navigationSlot,
  unavailableSlot,
  photosPendingSlot,
  privatePhotos = false,
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
          <Summary {...day} goal={goals?.calories} withGoal showSource />
        </Card>
      )}
      {!day && (
        <GoalComparison
          actual={null}
          goal={goals?.calories ?? null}
          unit="ккал"
        />
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
                          <MealPhoto
                            src={photo.href}
                            alt={`${m.meals[kind]} — ${photo.source === 'yazio' ? m.automatic : m.manual}`}
                            privatePhoto={privatePhotos}
                          />
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
              {meal && meal.entries.length > 0 && (
                <Box component="ul" className={classes.entries}>
                  {meal.entries.map((entry) => (
                    <Entry key={entry.id} entry={entry} />
                  ))}
                </Box>
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
