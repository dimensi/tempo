import 'server-only';
import { createHash } from 'node:crypto';
import type { McpHistoryInput } from '@/contracts/mcp';
import type { RecoveryDay, RecoverySleepEpisode } from '@/contracts/recovery';
import { readHealthAutoExportStatus } from '@/server/health-auto-export/repository';
import { getRecovery, RecoveryReadError } from '@/server/recovery';
import { McpReadError, pageRows, readOffset } from './pagination';

// Apple Health device labels can contain names. Keep the data provider in the tool response.
function episodeForMcp({
  startAt,
  endAt,
  durationSeconds,
  stages,
  awakeSeconds,
  inBedSeconds,
}: RecoverySleepEpisode) {
  return {
    startAt,
    endAt,
    durationSeconds,
    stages,
    awakeWithinEpisodeSeconds: awakeSeconds,
    inBedWithinEpisodeSeconds: inBedSeconds,
  };
}

function metricsForMcp(metrics: RecoveryDay['metrics']) {
  return Object.fromEntries(
    Object.entries(metrics).map(
      ([name, { value, unit, count, firstAt, lastAt }]) => [
        name,
        { value, unit, count, firstAt, lastAt },
      ],
    ),
  );
}

export async function readMcpRecovery(
  headers: Headers,
  ownerId: string,
  { from, to, timezone, detail, limit, cursor }: McpHistoryInput,
) {
  const binding = createHash('sha256')
    .update(
      JSON.stringify([
        ownerId,
        'get_sleep_recovery',
        from,
        to,
        timezone,
        detail,
      ]),
    )
    .digest('hex');
  if (cursor && detail === 'summary') throw new McpReadError('invalid_cursor');
  const offset = readOffset(cursor, binding);

  const recovery = await getRecovery(headers, ownerId, {
    from,
    to,
    timezone,
  }).catch((error: unknown) => {
    if (error instanceof RecoveryReadError) {
      if (error.status === 401 || error.status === 403)
        throw new McpReadError('access_denied');
      if (error.status === 422) throw new McpReadError('narrow_range');
    }
    throw error;
  });
  const { lastSuccessAt } = readHealthAutoExportStatus(ownerId);
  const rows: unknown[] =
    detail === 'records'
      ? recovery.days.flatMap(({ date, sleep }) =>
          sleep.map((episode) => ({ date, ...episodeForMcp(episode) })),
        )
      : detail === 'daily'
        ? recovery.days.map(({ date, sleep, metrics }) => ({
            date,
            sleep: sleep.length ? sleep.map(episodeForMcp) : null,
            metrics: metricsForMcp(metrics),
            coverage:
              sleep.length || Object.keys(metrics).length
                ? 'observed'
                : 'missing',
          }))
        : [];
  const page = pageRows(rows, offset, limit, binding);
  return {
    version: 1 as const,
    data: {
      range: recovery.range,
      source: recovery.source,
      lastSuccessAt,
      summary: {
        observedDays: recovery.summary.observedDays,
        missingDays: recovery.days.length - recovery.summary.observedDays,
        sleep: recovery.summary.sleep,
        metrics: metricsForMcp(recovery.summary.metrics),
      },
      ...(detail === 'summary' ? {} : { records: page.records }),
    },
    next_cursor: page.next_cursor,
  };
}
