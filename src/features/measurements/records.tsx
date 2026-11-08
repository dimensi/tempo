import type { Measurement } from '@/contracts/measurements';
import { readWorkspaceMessages } from '@/config/read-workspace';
import { useViewState } from '@/lib/use-view-state';
import {
  Accordion,
  ActionIcon,
  Button,
  Group,
  Menu,
  Pagination,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconDots,
  IconMessageCircle,
  IconPencil,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useId, type ReactNode } from 'react';
import { measurementChange } from './history';
import { measurementMessages as m } from './messages';
import styles from './measurements.module.css';

const pageSize = 8;
const recordDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function displayValue(value: Measurement['values'][number]) {
  return `${value.value.replace('.', ',')}\u00a0${m.units[value.unit]}`;
}

export function MeasurementRecords({
  items,
  loading,
  loadError,
  writable,
  confirmed,
  busy,
  retrying,
  editBlocked,
  onEdit,
  onDelete,
  onRetry,
  renderComments,
}: {
  items: Measurement[];
  loading: boolean;
  loadError: boolean;
  writable: boolean;
  confirmed: boolean;
  busy: boolean;
  retrying: string | undefined;
  editBlocked: (id: string) => boolean;
  onEdit: (item: Measurement) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  renderComments?: (id: string) => ReactNode;
}) {
  const headingId = useId();
  const commentsId = useId();
  const [open, setOpen] = useViewState<string | null>(
    'measurements:record',
    null,
  );
  const [comments, setComments] = useViewState<string | null>(
    'measurements:comments',
    null,
  );
  const [page, setPage] = useViewState('measurements:history-page', 1);
  const total = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, total);
  const start = (current - 1) * pageSize;
  const rows = items.slice(start, start + pageSize);

  return (
    <Stack component="section" aria-labelledby={headingId} gap="xs">
      <Title order={2} size="h4" id={headingId}>
        {m.history}
      </Title>
      {loading ? (
        <Text size="sm" c="dimmed" role="status">
          {m.loading}
        </Text>
      ) : rows.length === 0 ? (
        !loadError && (
          <Text size="sm" c="dimmed">
            {m.emptyHistory}
          </Text>
        )
      ) : (
        <Accordion
          value={open}
          onChange={setOpen}
          variant="default"
          classNames={{
            control: styles.recordControl,
            label: styles.recordLabel,
            content: styles.recordContent,
          }}
        >
          {rows.map((item) => {
            const date = recordDate.format(new Date(item.measuredAt));
            const retry = item.sync.some(
              ({ state }) =>
                state === 'failed' ||
                state === 'uncertain' ||
                state === 'conflict',
            );
            return (
              <Accordion.Item key={item.id} value={item.id}>
                <Group gap={2} wrap="nowrap" className={styles.recordRow}>
                  <Accordion.Control>
                    <span className={styles.recordSummary}>
                      <Text
                        component="time"
                        dateTime={item.measuredAt}
                        fw={650}
                        size="sm"
                      >
                        {date}
                      </Text>
                      <span className={styles.recordPreview}>
                        {item.values.slice(0, 2).map((value) => (
                          <span key={value.metric}>
                            <Text component="span" size="sm" c="dimmed">
                              {m.metrics[value.metric]}{' '}
                            </Text>
                            <Text component="span" size="sm" fw={600}>
                              {displayValue(value)}
                            </Text>
                          </span>
                        ))}
                        {item.values.length > 2 && (
                          <Text component="span" size="xs" c="dimmed">
                            {m.moreMetrics(item.values.length - 2)}
                          </Text>
                        )}
                      </span>
                    </span>
                  </Accordion.Control>
                  {writable && (
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon
                          variant="transparent"
                          className={styles.recordMenu}
                          color="gray"
                          size={44}
                          aria-label={m.actions(date)}
                          loading={retrying === item.id}
                          disabled={busy}
                        >
                          <IconDots size={19} aria-hidden />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {(!confirmed || editBlocked(item.id)) && (
                          <Menu.Label>
                            {confirmed
                              ? m.draftInProgress
                              : readWorkspaceMessages.recordUnconfirmed}
                          </Menu.Label>
                        )}
                        <Menu.Item
                          mih={44}
                          disabled={!confirmed || editBlocked(item.id)}
                          leftSection={<IconPencil size={17} aria-hidden />}
                          onClick={() => onEdit(item)}
                        >
                          {m.edit}
                        </Menu.Item>
                        {retry && (
                          <Menu.Item
                            mih={44}
                            disabled={retrying !== undefined}
                            leftSection={<IconRefresh size={17} aria-hidden />}
                            onClick={() => onRetry(item.id)}
                          >
                            {m.retrySync}
                          </Menu.Item>
                        )}
                        <Menu.Item
                          mih={44}
                          color="red"
                          disabled={!confirmed}
                          leftSection={<IconTrash size={17} aria-hidden />}
                          onClick={() => onDelete(item.id)}
                        >
                          {m.remove}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
                <Accordion.Panel>
                  {open === item.id && (
                    <Stack gap="sm">
                      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
                        {item.values.map((value) => {
                          const status = item.sync.find(
                            ({ metric }) => metric === value.metric,
                          );
                          const change = measurementChange(
                            items,
                            item,
                            value.metric,
                          );
                          return (
                            <div key={value.metric}>
                              <Text size="sm">{m.metrics[value.metric]}</Text>
                              <Group gap={8} align="baseline">
                                <Text fw={650} className={styles.number}>
                                  {displayValue(value)}
                                </Text>
                                {change !== null && (
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    className={styles.number}
                                  >
                                    {change.replace('.', ',')}
                                  </Text>
                                )}
                              </Group>
                              <Text size="xs" c="dimmed">
                                {status ? m.sync[status.state] : m.localOnly}
                              </Text>
                              {status?.state === 'conflict' && (
                                <Text size="xs" className={styles.note}>
                                  {m.remoteValue}: {status.remoteValue}
                                </Text>
                              )}
                            </div>
                          );
                        })}
                      </SimpleGrid>
                      {item.note && (
                        <Text size="sm" className={styles.note}>
                          {item.note}
                        </Text>
                      )}
                      {renderComments && (
                        <Stack gap="xs">
                          <Button
                            className={styles.fieldAction}
                            size="sm"
                            mih={44}
                            variant={comments === item.id ? 'light' : 'subtle'}
                            leftSection={
                              <IconMessageCircle size={18} aria-hidden />
                            }
                            aria-expanded={comments === item.id}
                            aria-controls={commentsId}
                            onClick={() =>
                              setComments(comments === item.id ? null : item.id)
                            }
                          >
                            {m.comments}
                          </Button>
                          <div id={commentsId} hidden={comments !== item.id}>
                            {comments === item.id && renderComments(item.id)}
                          </div>
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
      {total > 1 && (
        <Pagination.Root
          size={44}
          total={total}
          value={current}
          onChange={setPage}
        >
          <Group justify="space-between" gap="xs">
            <Text size="sm" c="dimmed" role="status">
              {m.pageRange(start + 1, start + rows.length, items.length)}
            </Text>
            <Group gap={4}>
              <Pagination.Previous aria-label={m.previousPage} />
              <Pagination.Next aria-label={m.nextPage} />
            </Group>
          </Group>
        </Pagination.Root>
      )}
    </Stack>
  );
}
