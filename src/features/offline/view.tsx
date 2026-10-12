'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import Decimal from 'decimal.js';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import type { OfflineSnapshot } from '@/contracts/offline';
import type { NutritionTotals } from '@/contracts/nutrition';
import { healthRangeDates } from '@/contracts/health';
import { hasNutritionMealContent } from '@/lib/nutrition-meal-content';
import { formatDecimal } from '@/lib/number-display';
import { revealOfflineContent } from '@/lib/offline-device';
import { getOfflineController } from './controller';
import { attachOfflineRefresh } from './refresh';
import { offlineMessages as m } from './messages';
import classes from './offline.module.css';

const display = (value: string | number | null) =>
  formatDecimal(value) ?? m.noData;
const badgeStyles = {
  fontSize: 16,
  color: 'var(--mantine-color-text)',
  borderColor: 'var(--mantine-color-text)',
  textTransform: 'none' as const,
};
const nutrientKeys = ['calories', 'protein', 'fat', 'carbs'] as const;
function Nutrients({
  totals,
  knownTotals,
  officialTotals,
  delta,
}: {
  totals: NutritionTotals;
  knownTotals: NutritionTotals;
  officialTotals: NutritionTotals;
  delta: NutritionTotals;
}) {
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{m.value}</Table.Th>
            <Table.Th>{m.computed}</Table.Th>
            <Table.Th>{m.known}</Table.Th>
            <Table.Th>YAZIO</Table.Th>
            <Table.Th>{m.difference}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {nutrientKeys.map((key) => (
            <Table.Tr key={key}>
              <Table.Td>
                {m[key]}, {key === 'calories' ? m.kcal : m.grams}
              </Table.Td>
              <Table.Td>{display(totals[key])}</Table.Td>
              <Table.Td>{display(knownTotals[key])}</Table.Td>
              <Table.Td>{display(officialTotals[key])}</Table.Td>
              <Table.Td>{display(delta[key])}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
function Diary({
  snapshot,
  photos,
}: {
  snapshot: OfflineSnapshot;
  photos: ReadonlyMap<string, Blob>;
}) {
  return snapshot.diary.length === 0 ? (
    <Text>{m.empty}</Text>
  ) : (
    <Accordion multiple variant="separated">
      {snapshot.diary.map((day) => {
        const meals = day.meals.filter((meal) =>
          hasNutritionMealContent(
            meal,
            snapshot.photos.items.some(
              (photo) => photo.date === day.date && photo.daytime === meal.kind,
            ),
          ),
        );
        return (
          <Accordion.Item value={day.date} key={day.date}>
            <Accordion.Control>{day.date}</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <Nutrients {...day} />
                {meals.length === 0 ? (
                  <Text>{m.empty}</Text>
                ) : (
                  meals.map((meal) => (
                    <Stack key={meal.kind} gap="sm">
                      <Title order={3}>{m[meal.kind]}</Title>
                      <Nutrients {...meal} />
                      {snapshot.photos.items
                        .filter(
                          (photo) =>
                            photo.date === day.date &&
                            photo.daytime === meal.kind,
                        )
                        .map((photo) => (
                          <SavedPhoto
                            key={photo.id}
                            bytes={photos.get(photo.id)}
                            label={`${day.date} · ${m[meal.kind]}`}
                          />
                        ))}
                      {meal.entries.map((entry) => (
                        <Stack
                          key={entry.key}
                          gap={4}
                          className={classes.entry}
                        >
                          <Text fw={600}>{entry.name}</Text>
                          <Text>{entry.diaryDateTime}</Text>
                          <Text>
                            {m.amount}: {display(entry.amount)}{' '}
                            {entry.baseUnit ?? ''}
                          </Text>
                          {entry.serving && (
                            <Text>
                              {m.portion}: {entry.serving} ·{' '}
                              {display(entry.servingQuantity)}
                            </Text>
                          )}
                          {(entry.consumedPortions !== null ||
                            entry.recipePortions !== null) && (
                            <Text>
                              {m.portions}: {display(entry.consumedPortions)} /{' '}
                              {display(entry.recipePortions)}
                            </Text>
                          )}
                          {(entry.massG !== null ||
                            entry.volumeMl !== null ||
                            entry.ingredientMassEstimateG !== null) && (
                            <Text>
                              {m.mass}: {display(entry.massG)} {m.grams} ·
                              Объём: {display(entry.volumeMl)} {m.ml} · Оценка
                              ингредиентов:{' '}
                              {display(entry.ingredientMassEstimateG)} {m.grams}
                            </Text>
                          )}
                          <Group>
                            {nutrientKeys.map((key) => (
                              <Text key={key}>
                                {m[key]}: {display(entry.totals[key])}
                              </Text>
                            ))}
                          </Group>
                          {entry.issues.length > 0 && (
                            <Text>{entry.issues.join('; ')}</Text>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  ))
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );
}
function SavedPhoto({
  bytes,
  label,
}: {
  bytes: Blob | undefined;
  label: string;
}) {
  const image = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!bytes) return;
    const next = URL.createObjectURL(bytes);
    const node = image.current;
    if (node) node.src = next;
    return () => {
      URL.revokeObjectURL(next);
      node?.removeAttribute('src');
    };
  }, [bytes]);
  if (!bytes) return <Text>{m.noPhoto}</Text>;
  return <Image ref={image} alt={label} fit="contain" maw={640} />;
}
function Measurements({ snapshot }: { snapshot: OfflineSnapshot }) {
  return (
    <Stack>
      <Title order={2}>{m.measurements}</Title>
      {snapshot.measurements.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        <Table.ScrollContainer minWidth={300}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{m.date}</Table.Th>
                <Table.Th>{m.value}</Table.Th>
                <Table.Th>{m.source}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {snapshot.measurements.map((record) => (
                <Table.Tr key={record.key}>
                  <Table.Td>{record.measuredAt}</Table.Td>
                  <Table.Td>
                    {record.values.map((value) => (
                      <Text key={value.metric}>
                        {m.metric[value.metric]}: {display(value.value)}{' '}
                        {value.unit === 'kg' ? m.kg : m.cm}
                      </Text>
                    ))}
                    {record.note && <Text>{record.note}</Text>}
                  </Table.Td>
                  <Table.Td>{m.manual}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Title order={2}>{m.weight}</Title>
      <Text>{m.weightHelp}</Text>
      {snapshot.importedWeights.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        <Table.ScrollContainer minWidth={300}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{m.date}</Table.Th>
                <Table.Th>{m.value}</Table.Th>
                <Table.Th>{m.source}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {snapshot.importedWeights.map((record) => (
                <Table.Tr key={record.key}>
                  <Table.Td>{record.measuredDate}</Table.Td>
                  <Table.Td>
                    {display(record.rawValue)}{' '}
                    {record.rawValue !== null && m.kg}
                    <Text>{m.ownerConfirmed}</Text>
                  </Table.Td>
                  <Table.Td>YAZIO</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
function Steps({ snapshot }: { snapshot: OfflineSnapshot }) {
  const byDate = new Map(
    snapshot.dailySteps.map((day) => [day.date, day.steps]),
  );
  const days = healthRangeDates({ from: snapshot.from, to: snapshot.to }).map(
    (date) => ({ date, steps: byDate.get(date) ?? null }),
  );
  const recorded = days.filter((day) => day.steps !== null);
  const total = recorded.reduce(
    (sum, day) => sum.plus(day.steps!),
    new Decimal(0),
  );
  return (
    <Stack>
      <Group>
        <Title order={2}>{m.steps}</Title>
        <Badge variant="outline" style={badgeStyles}>
          YAZIO
        </Badge>
      </Group>
      <Text>
        {m.recordedDays}: {recorded.length} / {days.length}
      </Text>
      <Text>
        {m.total}: {recorded.length ? display(total.toFixed()) : m.noData}
      </Text>
      <Text>{m.zeroHelp}</Text>
      {recorded.length > 0 && (
        <LineChart
          h={240}
          data={days}
          dataKey="date"
          series={[{ name: 'steps', label: m.steps, color: 'blue.7' }]}
          curveType="linear"
          connectNulls={false}
          withDots
          valueFormatter={display}
          xAxisProps={{
            tick: { fontSize: 16, fill: 'var(--mantine-color-text)' },
          }}
          yAxisProps={{
            tick: { fontSize: 16, fill: 'var(--mantine-color-text)' },
            domain: [0, 'auto'],
          }}
        />
      )}
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{m.date}</Table.Th>
            <Table.Th>{m.steps}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {days.map((day) => (
            <Table.Tr key={day.date}>
              <Table.Td>{day.date}</Table.Td>
              <Table.Td>
                {day.steps === null ? m.noData : String(day.steps)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
function LocalExercises({
  exercises,
}: {
  exercises: OfflineSnapshot['plannedWorkouts'][number]['exercises'];
}) {
  return (
    <Stack>
      {exercises.map((exercise, index) => (
        <Stack key={index} gap={4}>
          <Text fw={600}>{exercise.name}</Text>
          {exercise.comment && <Text>{exercise.comment}</Text>}
          {exercise.sets.map((set, setIndex) => (
            <Text key={setIndex}>
              {setIndex + 1}: {set.reps} {m.reps} · {display(set.weightKg)}{' '}
              {m.kg}
            </Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
function Workouts({ snapshot }: { snapshot: OfflineSnapshot }) {
  return (
    <Stack>
      <Title order={2}>{m.plans}</Title>
      {snapshot.plannedWorkouts.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        snapshot.plannedWorkouts.map((workout) => (
          <Stack key={workout.key} className={classes.entry}>
            <Title order={3}>
              {workout.date} · {workout.title}
            </Title>
            <Text>{workout.planTitle}</Text>
            {workout.planDescription && <Text>{workout.planDescription}</Text>}
            <LocalExercises exercises={workout.exercises} />
          </Stack>
        ))
      )}
      <Title order={2}>{m.sessions}</Title>
      {snapshot.workoutSessions.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        snapshot.workoutSessions.map((workout) => (
          <Stack key={workout.key} className={classes.entry}>
            <Title order={3}>
              {workout.date} · {workout.title}
            </Title>
            <Text>{m.status[workout.status]}</Text>
            {workout.planTitle && <Text>{workout.planTitle}</Text>}
            {workout.note && <Text>{workout.note}</Text>}
            <LocalExercises exercises={workout.exercises} />
          </Stack>
        ))
      )}
      <Title order={2}>{m.nativeHistory}</Title>
      {snapshot.nativeTrainings.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        snapshot.nativeTrainings.map((training) => (
          <Stack key={training.key} className={classes.entry}>
            <Title order={3}>
              {training.date} · {training.title}
            </Title>
            <Badge variant="outline" style={badgeStyles}>
              TransformMate
            </Badge>
            <Text>
              {m.progress}: {training.progress}
            </Text>
            <Text>
              {m.started}: {training.started ?? m.noData} · {m.finished}:{' '}
              {training.finished ?? m.noData}
            </Text>
            <Text>
              {m.fetchedAt}: {training.fetchedAt}
            </Text>
            <Text>
              {m.remoteUpdated}: {training.remoteUpdatedAt}
            </Text>
            {training.exercises
              .toSorted(
                (a, b) =>
                  a.protocolOrder - b.protocolOrder || a.order - b.order,
              )
              .map((exercise, index) => (
                <Stack key={index} gap={4}>
                  <Text fw={600}>
                    {exercise.protocolOrder}.{exercise.order} · {exercise.name}
                  </Text>
                  {exercise.comment && <Text>{exercise.comment}</Text>}
                  {exercise.metrics.map((group, index) => (
                    <Stack key={index} gap={4}>
                      <Text fw={600}>
                        {group.type === 'plan' ? m.plans : m.actual}
                      </Text>
                      {group.sets
                        .toSorted((a, b) => a.order - b.order)
                        .map((set) => (
                          <Stack key={set.order} gap={4}>
                            <Text>
                              {set.order}:{' '}
                              {set.done === null
                                ? m.noData
                                : set.done
                                  ? m.done
                                  : m.notDone}
                            </Text>
                            {set.metrics.map((metric, index) => (
                              <Text key={index}>
                                {metric.name} ({metric.type}):{' '}
                                {metric.values.length
                                  ? metric.values.join(' / ')
                                  : m.noData}{' '}
                                {metric.unit}
                              </Text>
                            ))}
                          </Stack>
                        ))}
                    </Stack>
                  ))}
                </Stack>
              ))}
          </Stack>
        ))
      )}
      <Title order={2}>{m.facts}</Title>
      {snapshot.transformMateFacts.length === 0 ? (
        <Text>{m.empty}</Text>
      ) : (
        snapshot.transformMateFacts.map((fact) => (
          <Stack key={fact.key} className={classes.entry}>
            <Title order={3}>
              {fact.date} · {fact.title}
            </Title>
            <Text>
              {m.started}: {fact.started ?? m.noData} · Завершение:{' '}
              {fact.finished ?? m.noData}
            </Text>
            <Text>
              {m.checked}:{' '}
              {fact.checkedAt
                ? new Date(fact.checkedAt).toLocaleString('ru-RU')
                : m.noData}
            </Text>
            {fact.exercises.map((exercise, index) => (
              <Stack key={index} gap={4}>
                <Text fw={600}>{exercise.name}</Text>
                {exercise.comment && <Text>{exercise.comment}</Text>}
                {exercise.sets.map((set) => (
                  <Stack key={set.order} gap={4}>
                    <Text>
                      {set.order}: {set.done ? m.done : m.notDone}
                    </Text>
                    {set.metrics.map((metric, metricIndex) => (
                      <Text key={metricIndex}>
                        {metric.name}:{' '}
                        {metric.values.length
                          ? metric.values.join(' / ')
                          : m.noData}{' '}
                        {metric.unit}
                      </Text>
                    ))}
                  </Stack>
                ))}
              </Stack>
            ))}
          </Stack>
        ))
      )}
    </Stack>
  );
}
export function OfflineViewer() {
  const controller = getOfflineController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useEffect(() => {
    const stop = controller.listen();
    const detach = attachOfflineRefresh(controller);
    return () => {
      stop();
      detach();
    };
  }, [controller]);
  useLayoutEffect(() => {
    if (state.bundle) revealOfflineContent(state.bundle.fence);
  }, [state]);
  const bundle = state.bundle;
  const photoMap = new Map(
    state.photos.map((photo) => [photo.id, photo.bytes]),
  );
  return (
    <main className={classes.reader} data-testid="offline-reader">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>{m.title}</Title>
          <Anchor href="/settings#offline" c="var(--mantine-color-text)">
            {m.settings}
          </Anchor>
        </Group>
        <Text>{m.disclosure}</Text>
        <Text>{m.readonly}</Text>
        {state.status === 'checking' && <Text role="status">{m.checking}</Text>}
        {state.error && (
          <Alert color="red" role="alert">
            {m[state.error]}
          </Alert>
        )}
        {!bundle && state.status !== 'checking' && !state.error && (
          <Text>{m.off}</Text>
        )}
        {bundle && (
          <div data-offline-private className={classes.private}>
            <Paper withBorder p="md">
              <Stack gap="xs">
                <Text fw={600}>
                  {state.status === 'offline' ? m.offline : m.saved}
                </Text>
                <Text>
                  {bundle.snapshot.from} — {bundle.snapshot.to}
                </Text>
                <Text>
                  {m.saved}: {new Date(bundle.savedAt).toLocaleString('ru-RU')}
                </Text>
                <Text>
                  {m.photoCoverage}: {state.photos.length} /{' '}
                  {bundle.snapshot.photos.items.length}
                </Text>
                {bundle.missingPhotos.length > 0 && (
                  <Text>{m.partialPhotos}</Text>
                )}
                <Button
                  variant="outline"
                  style={{
                    color: 'var(--mantine-color-text)',
                    borderColor: 'var(--mantine-color-text)',
                  }}
                  mih={44}
                  onClick={() => void controller.disable()}
                >
                  {m.disable}
                </Button>
              </Stack>
            </Paper>
            <Tabs defaultValue="diary" keepMounted={false}>
              <Tabs.List className={classes.tabs}>
                {(
                  [
                    'diary',
                    'photos',
                    'measurements',
                    'steps',
                    'workouts',
                  ] as const
                ).map((tab) => (
                  <Tabs.Tab key={tab} value={tab}>
                    {m[tab]}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <Tabs.Panel value="diary" pt="lg">
                <Diary snapshot={bundle.snapshot} photos={photoMap} />
              </Tabs.Panel>
              <Tabs.Panel value="photos" pt="lg">
                <Stack>
                  {bundle.snapshot.photos.items.length === 0 ? (
                    <Text>{m.empty}</Text>
                  ) : (
                    bundle.snapshot.photos.items.map((photo) => (
                      <Stack key={photo.id}>
                        <Group>
                          <Title order={2}>
                            {photo.date} · {m[photo.daytime]}
                          </Title>
                          <Badge variant="outline" style={badgeStyles}>
                            {photo.source === 'manual' ? m.manual : 'YAZIO'}
                          </Badge>
                        </Group>
                        <SavedPhoto
                          bytes={photoMap.get(photo.id)}
                          label={`${photo.date} · ${m[photo.daytime]}`}
                        />
                      </Stack>
                    ))
                  )}
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="measurements" pt="lg">
                <Measurements snapshot={bundle.snapshot} />
              </Tabs.Panel>
              <Tabs.Panel value="steps" pt="lg">
                <Steps snapshot={bundle.snapshot} />
              </Tabs.Panel>
              <Tabs.Panel value="workouts" pt="lg">
                <Workouts snapshot={bundle.snapshot} />
              </Tabs.Panel>
            </Tabs>
          </div>
        )}
      </Stack>
    </main>
  );
}
