import 'server-only';
import { getDatabase } from '@/server/db';
import {
  offlineViewsSchema,
  offlineSummaryDaySchema,
  type OfflineViews,
} from '@/contracts/offline-views';
import { measurementValueSchema } from '@/contracts/measurements';
import { ownerConfirmedYazioWeightUnit } from '@/contracts/yazio-weight-policy';
import { shiftDate } from '@/contracts/nutrition-sync-dates';
import { z } from 'zod';
import { yazioObservationDate } from '@/lib/yazio-observations';
import { catalogStore } from '@/server/transformmate/catalog-store';
import { catalogItem } from '@/server/transformmate/catalog-projection';

// Local SQL projections only. Credentials, signed URLs and raw provider payloads
// never leave this module. Each collection is bounded independently.
export function readOfflineViews(input: {
  ownerId: string;
  role: 'OWNER' | 'TRAINER';
  from: string;
  to: string;
  accountScope: string | null;
  connectionId: string | null;
  transformMateConnected: boolean;
  key: (purpose: string, id: string) => string;
}): OfflineViews {
  const { sqlite } = getDatabase();
  const { ownerId, from, to, key } = input;
  const summaryFrom = shiftDate(to, -365);
  const planned =
    sqlite
      .prepare(
        `SELECT json_extract(w.value,'$.title') AS title,json_extract(w.value,'$.date') AS date
    FROM workout_plans p,json_each(p.data,'$.workouts') w WHERE p.owner_id=? AND json_extract(w.value,'$.date') >= ?
    AND NOT EXISTS (SELECT 1 FROM workout_sessions s WHERE s.owner_id=p.owner_id AND json_extract(s.data,'$.planId')=p.id
      AND json_extract(s.data,'$.plannedWorkoutId')=json_extract(w.value,'$.id') AND json_extract(s.data,'$.status') IN ('completed','skipped'))
    ORDER BY date,p.id LIMIT 1`,
      )
      .get(ownerId, to) ?? null;
  const completed =
    sqlite
      .prepare(
        `SELECT json_extract(data,'$.title') AS title,date FROM workout_sessions
    WHERE owner_id=? AND date <= ? AND json_extract(data,'$.status')='completed' ORDER BY date DESC,updated_at DESC,id DESC LIMIT 1`,
      )
      .get(ownerId, to) ?? null;
  const latestWeight =
    sqlite
      .prepare(
        `SELECT measured_at AS date,json_extract(v.value,'$.value') AS value
    FROM measurements m,json_each(m.values_json) v WHERE m.owner_id=? AND m.measured_at <= ? AND json_extract(v.value,'$.metric')='weight'
    ORDER BY m.measured_at DESC,m.id DESC LIMIT 1`,
      )
      .get(ownerId, to) ?? null;
  const nutrition = sqlite
    .prepare(
      `SELECT json_object(
    'date',date,'fetchedAt',json_extract(snapshot,'$.fetchedAt'),
    'totals',json(json_extract(snapshot,'$.totals')),
    'knownTotals',json(json_extract(snapshot,'$.knownTotals')),
    'hasEntries',json(CASE WHEN EXISTS (
      SELECT 1 FROM json_each(snapshot,'$.meals') m, json_each(m.value,'$.entries')
    ) THEN 'true' ELSE 'false' END)) AS data
    FROM nutrition_days WHERE owner_id=? AND date BETWEEN ? AND ? ORDER BY date LIMIT 366`,
    )
    .all(ownerId, summaryFrom, to) as { data: string }[];
  const bodyRows = sqlite
    .prepare(
      `SELECT id,measured_at AS measuredAt,values_json AS data
    FROM measurements WHERE owner_id=? AND measured_at BETWEEN ? AND ?
    ORDER BY measured_at DESC,id DESC LIMIT 1001`,
    )
    .all(ownerId, summaryFrom, to) as {
    id: string;
    measuredAt: string;
    data: string;
  }[];
  const body = bodyRows
    .slice(0, 1000)
    .reverse()
    .map((row) => ({
      id: key('measurement', row.id),
      measuredAt: row.measuredAt,
      values: z
        .array(measurementValueSchema)
        .max(7)
        .parse(JSON.parse(row.data)),
    }));
  const imported = sqlite
    .prepare(
      `SELECT coalesce(measured_date,substr(provider_date,1,10)) AS measuredAt, measured_date AS measuredDate, provider_date AS providerDate,
    raw_value AS rawValue FROM yazio_weight_entries WHERE owner_id=?
    AND coalesce(measured_date,substr(provider_date,1,10)) BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM yazio_body_links l WHERE l.owner_id=yazio_weight_entries.owner_id AND l.provider_id=yazio_weight_entries.external_id AND l.metric='weight' AND l.measurement_id IS NOT NULL)
    ORDER BY measuredAt DESC,external_id DESC LIMIT 1001`,
    )
    .all(ownerId, summaryFrom, to) as {
    measuredAt: string;
    measuredDate: string | null;
    providerDate: string;
    rawValue: string | null;
  }[];
  const steps = sqlite
    .prepare(
      `SELECT date,steps,observed_at AS observedAt FROM yazio_daily_steps
    WHERE owner_id=? AND date BETWEEN ? AND ? ORDER BY date LIMIT 366`,
    )
    .all(ownerId, summaryFrom, to);
  const schedule = sqlite
    .prepare(
      `SELECT enabled,initial_from AS initialFrom,timezone,last_success AS lastSuccess
    FROM nutrition_schedule WHERE owner_id=?`,
    )
    .get(ownerId) as
    | {
        enabled: number;
        initialFrom: string | null;
        timezone: string;
        lastSuccess: number | null;
      }
    | undefined;
  const commentRows = sqlite
    .prepare(
      `SELECT c.id,c.target_type AS type,c.target_id AS targetId,
    c.parent_id AS parentId,c.body,c.created_at AS createdAt,u.name AS authorName,
    CASE c.target_type WHEN 'nutrition_day' THEN c.target_id WHEN 'measurement' THEN m.measured_at ELSE w.date END AS date
    FROM comments c JOIN user u ON u.id=c.author_id
    LEFT JOIN measurements m ON m.id=c.target_id AND m.owner_id=c.owner_id AND c.target_type='measurement'
    LEFT JOIN workout_sessions w ON w.id=c.target_id AND w.owner_id=c.owner_id AND c.target_type='workout'
    WHERE c.owner_id=? AND (c.target_type <> 'nutrition_day' OR EXISTS (SELECT 1 FROM nutrition_days n WHERE n.owner_id=c.owner_id AND n.date=c.target_id)) AND (CASE c.target_type WHEN 'nutrition_day' THEN c.target_id WHEN 'measurement' THEN m.measured_at ELSE w.date END) BETWEEN ? AND ?
    ORDER BY c.created_at DESC,c.id DESC LIMIT 501`,
    )
    .all(ownerId, from, to) as {
    id: string;
    type: string;
    targetId: string;
    parentId: string | null;
    body: string;
    createdAt: number;
    authorName: string;
    date: string;
  }[];
  const comments = commentRows.slice(0, 500).map((row) => ({
    key: key('comment', row.id),
    parentKey: row.parentId ? key('comment', row.parentId) : null,
    target:
      row.type === 'nutrition_day'
        ? `/diary?date=${row.date}`
        : row.type === 'measurement'
          ? `measurement:${key('measurement', row.targetId)}`
          : `/workouts/sessions/${encodeURIComponent(row.targetId)}`,
    date: row.date,
    body: row.body,
    authorName: row.authorName,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  let catalog: OfflineViews['catalog'] = [];
  let catalogComplete = false;
  if (input.accountScope && input.connectionId) {
    const scope = {
      ownerId,
      accountScope: input.accountScope,
      generation: input.connectionId,
      locale: 'ru' as const,
    };
    const store = catalogStore();
    // Only take a small saved catalog projection. No refresh/enrichment/provider call.
    const records = store.offlineRecords(scope);
    catalog = records.slice(0, 200).map((row) => {
      const item = catalogItem(
        row.summary,
        row.fetchedAt,
        row.detail,
        row.detailFetchedAt,
        scope,
      );
      return {
        id: item.id,
        name: item.name,
        description: row.detail?.description ?? null,
        muscleGroups: item.muscleGroups.map((group) => group.name),
        fetchedAt: row.detailFetchedAt ?? row.fetchedAt,
        hasVideo: Boolean(row.detail?.kinescope_data?.length),
      };
    });
    let bytes = 0;
    catalog = catalog.filter((item) => {
      bytes += Buffer.byteLength(JSON.stringify(item));
      return bytes <= 512 * 1024;
    });
    const state = store.state(scope);
    catalogComplete = Boolean(
      state?.full_catalog_fetched_at &&
      state.full_catalog_count === catalog.length,
    );
  }
  const videoRows = sqlite
    .prepare(
      `SELECT v.id,v.session_id AS sessionId,v.size FROM workout_videos v
    JOIN workout_sessions s ON s.id=v.session_id AND s.owner_id=v.owner_id
    WHERE v.owner_id=? AND v.state='ready' AND s.date BETWEEN ? AND ? ORDER BY v.created_at DESC LIMIT 100`,
    )
    .all(ownerId, from, to) as {
    id: string;
    sessionId: string;
    size: number;
  }[];
  return offlineViewsSchema.parse({
    summary: {
      from: summaryFrom,
      to,
      workouts: { planned, completed },
      latestWeight,
      nutrition: nutrition.map((row) =>
        offlineSummaryDaySchema.parse(JSON.parse(row.data)),
      ),
      body,
      bodyComplete: bodyRows.length <= 1000 && imported.length <= 1000,
      weight: {
        range: { from: summaryFrom, to },
        local: body.flatMap((row) =>
          row.values
            .filter((v) => v.metric === 'weight')
            .map((v) => ({
              measuredAt: row.measuredAt,
              value: v.value,
              unit: 'kg',
              source: 'LOCAL',
            })),
        ),
        imported: imported.slice(0, 1000).flatMap((row) => {
          const measuredAt = yazioObservationDate(
            row.measuredDate ?? row.providerDate,
          );
          return measuredAt && measuredAt >= summaryFrom && measuredAt <= to
            ? [
                {
                  measuredAt,
                  rawValue: row.rawValue,
                  ...ownerConfirmedYazioWeightUnit,
                  source: 'YAZIO',
                },
              ]
            : [];
        }),
      },
      steps,
    },
    settings:
      input.role === 'OWNER'
        ? {
            yazioConnected: Boolean(schedule?.enabled),
            transformMateConnected: input.transformMateConnected,
            initialFrom: schedule?.initialFrom ?? null,
            timezone: schedule?.timezone ?? 'UTC',
            automaticSync: Boolean(schedule?.enabled),
            lastSuccess:
              schedule?.lastSuccess == null
                ? null
                : new Date(schedule.lastSuccess).toISOString(),
          }
        : null,
    comments,
    commentsComplete: commentRows.length <= 500,
    catalog,
    catalogComplete,
    videos: videoRows.map((row) => ({
      id: row.id,
      sessionHref: `/workouts/sessions/${encodeURIComponent(row.sessionId)}`,
      size: row.size,
      href: `/api/workouts/videos/${encodeURIComponent(row.id)}/playback?ownerId=${encodeURIComponent(ownerId)}`,
    })),
  });
}
