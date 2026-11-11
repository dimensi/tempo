'use client';
import { Button, Group, Stack, Text } from '@mantine/core';
import type {
  ProgressOccurrence,
  ProgressSummary,
} from '@/contracts/exercise-progress';
import { repeatExerciseSets } from '@/lib/exercise-progress';
import { dateLabel, setsLabel } from './format';
import { progressMessages as m } from './messages';
import styles from './progress.module.css';

export function PreviousExercise({
  sources,
  loaded,
  error,
  onOpen,
  onRepeat,
}: {
  sources?: ProgressSummary['exercises'][number]['sources'];
  loaded: boolean;
  error: boolean;
  onOpen: () => void;
  onRepeat?: (row: ProgressOccurrence) => void;
}) {
  return (
    <Stack gap={4} className={styles.previous}>
      {sources?.length ? (
        sources.map(({ latest }) => (
          <div key={latest.source}>
            <Text size="sm" c="var(--progress-muted)">
              {m.previous} · {dateLabel(latest.date)} ·{' '}
              {m.source[latest.source]}
            </Text>
            <Text size="sm" className={styles.numbers} lineClamp={2}>
              {setsLabel(latest)}
            </Text>
          </div>
        ))
      ) : loaded ? (
        <Text size="sm" c="var(--progress-muted)">
          {m.noPrevious}
        </Text>
      ) : error ? (
        <Text size="sm" c="var(--progress-muted)">
          {m.notLoaded}
        </Text>
      ) : null}
      <Group className={styles.actions}>
        {onRepeat &&
          sources?.map(
            ({ latest }) =>
              repeatExerciseSets({ sets: [] }, latest) && (
                <Button
                  key={latest.source}
                  variant="transparent"
                  className={styles.action}
                  onClick={() => onRepeat(latest)}
                >
                  {m.repeat}
                  {sources.length > 1 ? ` · ${m.source[latest.source]}` : ''}
                </Button>
              ),
          )}
        <Button
          variant="transparent"
          className={styles.action}
          onClick={onOpen}
        >
          {m.history}
        </Button>
      </Group>
    </Stack>
  );
}
