import 'server-only';
import { syncProgress } from '@/server/yazio/sync-progress';
import {
  canonicalYazioBodyValue,
  sameYazioBodyValue,
} from '@/lib/yazio-observations';
import { measurementPrecisionIssueSchema } from '@/contracts/yazio-body';
import { randomUUID } from 'node:crypto';
import { and, eq, asc, inArray, lte, sql, or, lt, isNull } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { measurements } from '@/server/db/schema/measurements';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import {
  yazioBodyLinks as links,
  yazioBodyOutbox as jobs,
} from '@/server/db/schema/yazio-body';
import {
  bodyMetric,
  type BodyMetric,
  type BodyEntry,
  type MeasurementSync,
} from '@/contracts/yazio-body';
import {
  measurementValueSchema,
  type MeasurementInput,
} from '@/contracts/measurements';
export type BodyLink = typeof links.$inferSelect;
export type BodyJob = typeof jobs.$inferSelect;
export function bodyRepository(database = getDatabase()) {
  const db = database.db;
  const scope = (ownerId: string, epoch: number) =>
    and(eq(links.ownerId, ownerId), eq(links.epoch, epoch));
  const now = () => Date.now();
  function schedule(ownerId: string) {
    return db
      .select()
      .from(nutritionSchedule)
      .where(eq(nutritionSchedule.ownerId, ownerId))
      .get();
  }
  function assertEpoch(ownerId: string, epoch: number) {
    const s = schedule(ownerId);
    if (!s?.enabled || s.epoch !== epoch)
      throw new Error('Body connection changed');
  }
  function linked(ownerId: string, epoch: number) {
    return db.select().from(links).where(scope(ownerId, epoch)).all();
  }
  function jobState(
    id: string,
    state: BodyJob['state'],
    extra: Partial<BodyJob> = {},
  ) {
    db.update(jobs)
      .set({ ...extra, state })
      .where(eq(jobs.id, id))
      .run();
  }
  function enqueue(
    ownerId: string,
    measurementId: string,
    input: MeasurementInput,
    previous: MeasurementInput | null,
  ) {
    const s = schedule(ownerId);
    if (!s?.enabled) return;
    const current = linked(ownerId, s.epoch).filter(
      (l) => l.measurementId === measurementId,
    );
    for (const l of current)
      if (
        input.measuredAt !== l.providerDateTime.slice(0, 10) ||
        !input.values.some((v) => v.metric === l.metric)
      ) {
        db.update(links)
          .set({ measurementId: null })
          .where(eq(links.id, l.id))
          .run();
        db.update(jobs)
          .set({ state: 'cancelled' })
          .where(
            and(
              eq(jobs.linkId, l.id),
              inArray(jobs.state, ['pending', 'failed', 'conflict']),
            ),
          )
          .run();
      }
    for (const v of input.values) {
      if (!bodyMetric(v.metric)) continue;
      const prior = previous?.values.find((p) => p.metric === v.metric);
      if (
        previous?.measuredAt === input.measuredAt &&
        prior &&
        Number(prior.value) === Number(v.value)
      )
        continue;
      let link = current.find(
        (l) =>
          l.metric === v.metric &&
          l.providerDateTime.slice(0, 10) === input.measuredAt,
      );
      if (!link) {
        link = {
          id: randomUUID(),
          ownerId,
          epoch: s.epoch,
          providerId: randomUUID(),
          measurementId,
          metric: v.metric,
          providerDateTime: input.measuredAt + ' 00:00:00',
          syncedValue: null,
          remoteValue: null,
        };
        db.insert(links).values(link).run();
      }
      db.update(jobs)
        .set({ state: 'cancelled' })
        .where(
          and(
            eq(jobs.linkId, link.id),
            inArray(jobs.state, ['pending', 'failed', 'conflict']),
          ),
        )
        .run();
      db.insert(jobs)
        .values({
          id: randomUUID(),
          ownerId,
          epoch: s.epoch,
          linkId: link.id,
          revision:
            (db
              .select({ value: sql<number>`coalesce(max(${jobs.revision}),0)` })
              .from(jobs)
              .where(eq(jobs.linkId, link.id))
              .get()?.value ?? 0) + 1,
          value: v.value,
          baseline: link.syncedValue,
          state: 'pending',
          createdAt: now(),
          nextAttemptAt: now(),
        })
        .run();
    }
  }
  function status(ownerId: string, measurementId: string): MeasurementSync[] {
    const s = schedule(ownerId);
    return db
      .select()
      .from(links)
      .where(
        and(eq(links.ownerId, ownerId), eq(links.measurementId, measurementId)),
      )
      .all()
      .filter((l) => l.epoch === s?.epoch)
      .map((l) => {
        const job = db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.linkId, l.id),
              inArray(jobs.state, [
                'pending',
                'sending',
                'uncertain',
                'failed',
                'conflict',
              ]),
            ),
          )
          .orderBy(asc(jobs.createdAt), asc(jobs.revision))
          .get();
        return {
          metric: l.metric,
          state: !s?.enabled
            ? 'disconnected'
            : job?.state === 'sending'
              ? 'pending'
              : job &&
                  ['pending', 'failed', 'uncertain', 'conflict'].includes(
                    job.state,
                  )
                ? (job.state as MeasurementSync['state'])
                : 'synced',
          remoteValue: l.remoteValue,
        };
      });
  }
  function local(link: BodyLink) {
    return link.measurementId
      ? db
          .select()
          .from(measurements)
          .where(
            and(
              eq(measurements.ownerId, link.ownerId),
              eq(measurements.id, link.measurementId),
            ),
          )
          .get()
      : undefined;
  }
  function acknowledge(job: BodyJob, remote: BodyEntry) {
    assertEpoch(job.ownerId, job.epoch);
    db.update(links)
      .set({
        syncedValue: String(remote.value),
        remoteValue: String(remote.value),
      })
      .where(eq(links.id, job.linkId))
      .run();
    jobState(job.id, 'done');
  }
  function importEntryWork(
    ownerId: string,
    epoch: number,
    metric: BodyMetric,
    remote: BodyEntry,
  ) {
    assertEpoch(ownerId, epoch);
    const representable = measurementValueSchema.safeParse({
      metric,
      value: String(remote.value),
      unit: metric === 'weight' ? 'kg' : 'cm',
    }).success;
    const date = remote.date.slice(0, 10),
      value = String(remote.value);
    const known = linked(ownerId, epoch).find(
      (l) => l.providerId === remote.id,
    );
    if (known) {
      db.update(links)
        .set({ remoteValue: value })
        .where(eq(links.id, known.id))
        .run();
      const pending = db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.linkId, known.id),
            inArray(jobs.state, [
              'pending',
              'sending',
              'uncertain',
              'failed',
              'conflict',
            ]),
          ),
        )
        .all();
      if (known.metric !== metric || known.providerDateTime !== remote.date) {
        const existing = pending.find((job) => job.state === 'conflict');
        if (!existing) {
          const record = local(known);
          db.insert(jobs)
            .values({
              id: randomUUID(),
              ownerId,
              epoch,
              linkId: known.id,
              revision:
                (db
                  .select({
                    value: sql<number>`coalesce(max(${jobs.revision}),0)`,
                  })
                  .from(jobs)
                  .where(eq(jobs.linkId, known.id))
                  .get()?.value ?? 0) + 1,
              value:
                record?.values.find((v) => v.metric === known.metric)?.value ??
                known.syncedValue ??
                value,
              baseline: known.syncedValue,
              conflictValue: JSON.stringify({
                metric,
                date: remote.date,
                value,
              }),
              state: 'conflict',
              attempt: 0,
              nextAttemptAt: now(),
              createdAt: now(),
            })
            .run();
        }
        return;
      }
      if (pending.length) return;
      if (!representable) return;
      const record = local(known);
      if (!record) {
        // A precision-only observation never had a local association or intent.
        // A deleted/detached observation has a synced baseline or job history.
        const history = db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.linkId, known.id))
          .get();
        if (known.syncedValue === null && !history) {
          const measurementId = randomUUID();
          db.insert(measurements)
            .values({
              id: measurementId,
              ownerId,
              measuredAt: date,
              note: null,
              values: [
                { metric, value, unit: metric === 'weight' ? 'kg' : 'cm' },
              ],
            })
            .run();
          db.update(links)
            .set({ measurementId, syncedValue: value })
            .where(eq(links.id, known.id))
            .run();
        }
        return;
      }
      const old = record.values.find((v) => v.metric === metric);
      if (!old) return;
      if (
        known.syncedValue !== null &&
        !sameYazioBodyValue(old.value, known.syncedValue) &&
        !sameYazioBodyValue(remote.value, old.value)
      )
        return;
      db.update(measurements)
        .set({
          values: record.values.map((v) =>
            v.metric === metric ? { ...v, value } : v,
          ),
        })
        .where(eq(measurements.id, record.id))
        .run();
      db.update(links)
        .set({ syncedValue: value })
        .where(eq(links.id, known.id))
        .run();
      return;
    }
    const tombstone = db
      .select()
      .from(links)
      .where(
        and(
          eq(links.ownerId, ownerId),
          eq(links.providerId, remote.id),
          isNull(links.measurementId),
        ),
      )
      .all()
      .find(
        (old) =>
          old.epoch !== epoch &&
          (old.syncedValue !== null ||
            Boolean(
              db
                .select({ id: jobs.id })
                .from(jobs)
                .where(eq(jobs.linkId, old.id))
                .get(),
            )),
      );
    if (tombstone) {
      // Retain the owner's deletion across reconnects; never copy old intents.
      db.insert(links)
        .values({
          ...tombstone,
          id: randomUUID(),
          epoch,
          measurementId: null,
          remoteValue: value,
        })
        .run();
      return;
    }
    const candidates = db
      .select()
      .from(measurements)
      .where(
        and(
          eq(measurements.ownerId, ownerId),
          eq(measurements.measuredAt, date),
        ),
      )
      .all()
      .filter(
        (m) =>
          m.values.some(
            (v) => v.metric === metric && Number(v.value) === remote.value,
          ) &&
          !linked(ownerId, epoch).some(
            (l) => l.measurementId === m.id && l.metric === metric,
          ),
      );
    let measurementId: string | null;
    if (!representable) measurementId = null;
    else if (candidates.length === 1) measurementId = candidates[0]!.id;
    else {
      measurementId = randomUUID();
      db.insert(measurements)
        .values({
          id: measurementId,
          ownerId,
          measuredAt: date,
          note: null,
          values: [{ metric, value, unit: metric === 'weight' ? 'kg' : 'cm' }],
        })
        .run();
    }
    db.insert(links)
      .values({
        id: randomUUID(),
        ownerId,
        epoch,
        providerId: remote.id,
        measurementId,
        metric,
        providerDateTime: remote.date,
        syncedValue: representable ? value : null,
        remoteValue: value,
      })
      .run();
  }
  return {
    schedule,
    assertEpoch,
    linked,
    enqueue,
    status,
    local,
    jobState,
    acknowledge,
    importDay(
      ownerId: string,
      epoch: number,
      date: string,
      entries: { metric: BodyMetric; entry: BodyEntry }[],
    ) {
      database.sqlite.transaction(() => {
        assertEpoch(ownerId, epoch);
        for (const { metric, entry } of entries)
          importEntryWork(ownerId, epoch, metric, entry);
        syncProgress(database).set(ownerId, date, { body: true });
      })();
    },
    importEntry: (
      ownerId: string,
      epoch: number,
      metric: BodyMetric,
      remote: BodyEntry,
    ) =>
      database.sqlite.transaction(() =>
        importEntryWork(ownerId, epoch, metric, remote),
      )(),
    due: (ownerId: string, epoch: number, manual = false) =>
      db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, ownerId),
            eq(jobs.epoch, epoch),
            inArray(
              jobs.state,
              manual
                ? ['pending', 'sending', 'uncertain', 'failed', 'conflict']
                : ['pending', 'sending', 'uncertain', 'failed'],
            ),
            lte(jobs.nextAttemptAt, now()),
            manual
              ? undefined
              : or(
                  lt(jobs.attempt, 3),
                  inArray(jobs.state, ['sending', 'uncertain']),
                ),
          ),
        )
        .orderBy(asc(jobs.createdAt), asc(jobs.revision))
        .limit(32)
        .all(),
    blocked: (job: BodyJob) =>
      Boolean(
        db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.ownerId, job.ownerId),
              eq(jobs.epoch, job.epoch),
              eq(jobs.linkId, job.linkId),
              lt(jobs.revision, job.revision),
              inArray(jobs.state, ['sending', 'uncertain', 'conflict']),
            ),
          )
          .get(),
      ),
    job: (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get(),
    issues: (ownerId: string) => {
      const s = schedule(ownerId);
      return s
        ? linked(ownerId, s.epoch)
            .filter(
              (l) =>
                l.remoteValue !== null &&
                canonicalYazioBodyValue(l.remoteValue) === null,
            )
            .map((l) =>
              measurementPrecisionIssueSchema.parse({
                id: l.providerId,
                metric: l.metric,
                date: l.providerDateTime.slice(0, 10),
                dateTime: l.providerDateTime,
                value: l.remoteValue,
              }),
            )
        : [];
    },
    link: (id: string) => db.select().from(links).where(eq(links.id, id)).get(),
    remote: (id: string, value: string) =>
      db
        .update(links)
        .set({ remoteValue: value })
        .where(eq(links.id, id))
        .run(),
    retry: (ownerId: string, measurementId: string) => {
      const s = schedule(ownerId);
      if (!s?.enabled) return;
      for (const l of linked(ownerId, s.epoch).filter(
        (l) => l.measurementId === measurementId,
      ))
        db.update(jobs)
          .set({ nextAttemptAt: now(), attempt: 0 })
          .where(
            and(
              eq(jobs.linkId, l.id),
              inArray(jobs.state, ['uncertain', 'failed', 'conflict']),
            ),
          )
          .run();
    },
    detached: (ownerId: string, measurementId: string) => {
      for (const l of db
        .select()
        .from(links)
        .where(
          and(
            eq(links.ownerId, ownerId),
            eq(links.measurementId, measurementId),
          ),
        )
        .all()) {
        db.update(links)
          .set({ measurementId: null })
          .where(eq(links.id, l.id))
          .run();
        db.update(jobs)
          .set({ state: 'cancelled' })
          .where(
            and(
              eq(jobs.linkId, l.id),
              inArray(jobs.state, ['pending', 'failed', 'conflict']),
            ),
          )
          .run();
      }
    },
  };
}
