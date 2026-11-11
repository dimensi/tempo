'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronRight, IconSearch } from '@tabler/icons-react';
import { useReadResource } from '@/lib/use-read-resource';
import { readResources } from '@/lib/read-descriptors';
import { progressRange } from '@/lib/exercise-progress';
import { ExerciseHistory, ProgressReadState } from './history';
import { progressMessages as m } from './messages';
import { dateLabel, numberLabel, setLabel, setsLabel } from './format';
import styles from './progress.module.css';

export function ExerciseProgressOverview({
  ownerId,
  from,
  to,
}: {
  ownerId: string;
  from: string;
  to: string;
}) {
  const read = useReadResource(
    readResources.exerciseProgress(
      `/api/read/exercise-progress/summary?${new URLSearchParams({ ownerId, from, to })}`,
    ),
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{
    exerciseId: number;
    name: string;
  } | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const rows = read.data?.exercises.filter((row) =>
    row.name
      .toLocaleLowerCase('ru')
      .includes(search.trim().toLocaleLowerCase('ru')),
  );
  const sparse =
    read.data &&
    (!read.data.exercises.length ||
      read.data.exercises.every((row) =>
        row.sources.every((source) => source.completedCount < 2),
      ));
  return (
    <Paper
      component="section"
      withBorder
      className={styles.overview}
      aria-labelledby="exercise-progress-heading"
    >
      <Stack gap="md">
        <Title order={2} id="exercise-progress-heading">
          {m.title}
        </Title>
        <ProgressReadState read={read} />
        {read.data && (
          <>
            <TextInput
              aria-label={m.search}
              placeholder={m.search}
              leftSection={<IconSearch size={18} />}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            {!rows?.length && (
              <Text size="sm" c="var(--progress-muted)">
                {search ? m.noMatches : m.empty}
              </Text>
            )}
            <div>
              {rows?.map((row) => (
                <UnstyledButton
                  key={row.exerciseId}
                  className={styles.summaryRow}
                  onClick={() => setSelected(row)}
                >
                  <Text fw={600} className={styles.summaryName}>
                    {row.name}
                  </Text>
                  <Stack gap="md" className={styles.summaryResults}>
                    {row.sources.map((source) => (
                      <div key={source.source}>
                        <Text size="xs" c="var(--progress-muted)" mb={6}>
                          {m.source[source.source]} ·{' '}
                          {dateLabel(source.latest.date)}
                        </Text>
                        <div className={styles.sourceSummary}>
                          <div>
                            <Text size="xs" c="var(--progress-muted)">
                              {m.latest}
                            </Text>
                            <Text
                              size="sm"
                              className={styles.numbers}
                              lineClamp={2}
                            >
                              {setsLabel(source.latest)}
                            </Text>
                          </div>
                          <div>
                            <Text size="xs" c="var(--progress-muted)">
                              {m.best}
                            </Text>
                            <Text size="sm" className={styles.numbers}>
                              {source.best?.weightKg !== null && source.best
                                ? setLabel(source.best)
                                : '—'}
                            </Text>
                          </div>
                        </div>
                        {source.repChange && (
                          <Text size="sm" mt={6}>
                            {m.sameWeight}:{' '}
                            {source.repChange.weightKg === null
                              ? m.noWeight
                              : `${numberLabel(source.repChange.weightKg)} ${m.kg}`}{' '}
                            ·{' '}
                            {source.repChange.current -
                              source.repChange.previous >
                            0
                              ? '+'
                              : ''}
                            {source.repChange.current -
                              source.repChange.previous}{' '}
                            {m.repsUnit}
                          </Text>
                        )}
                      </div>
                    ))}
                  </Stack>
                  <IconChevronRight size={20} className={styles.chevron} />
                </UnstyledButton>
              ))}
            </div>
            {sparse && (
              <Group>
                <Text size="sm" c="var(--progress-muted)">
                  {m.notEnough}
                </Text>
                <Button
                  variant="subtle"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    const range = progressRange(to, 90);
                    next.set('from', range.from);
                    next.set('to', range.to);
                    next.set('period', 'custom');
                    router.push(`/analytics?${next}`);
                  }}
                >
                  {m.expand}
                </Button>
              </Group>
            )}
            <Text size="sm" c="var(--progress-muted)">
              {m.sourcesHint}
            </Text>
          </>
        )}
        {selected && (
          <ExerciseHistory
            key={`${ownerId}:${selected.exerciseId}`}
            ownerId={ownerId}
            {...selected}
            anchorDate={to}
            onClose={() => setSelected(null)}
          />
        )}
      </Stack>
    </Paper>
  );
}
