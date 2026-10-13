import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase } from '@/server/db/connection';
import { user } from '@/server/db/schema';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { measurements } from '@/server/db/schema/measurements';
import { yazioBodyOutbox } from '@/server/db/schema/yazio-body';
import { measurementRepository } from '@/server/measurements/repository';
import { bodyRepository } from '@/server/yazio/body-repository';
import { syncBodyJobs, pullBodyDates } from '@/server/jobs/yazio-body-sync';
import {
  bodyMetricKeys,
  type BodySummary,
  type BodyEntry,
  type BodyMetric,
} from '@/contracts/yazio-body';
import type { BodyUpstream } from '@/server/yazio/body-adapter';
let database: ReturnType<typeof openDatabase>,
  repo: ReturnType<typeof bodyRepository>;
const owner = 'synthetic-body-owner',
  date = '2026-10-13';
const input = (value: string) => ({
  measuredAt: date,
  note: 'keep note',
  values: [
    { metric: 'weight' as const, value, unit: 'kg' as const },
    { metric: 'neck' as const, value: '40', unit: 'cm' as const },
  ],
});
const fence = async () => repo.assertEpoch(owner, 1);
let remote: BodySummary, source: BodyUpstream;
function save(value = '80') {
  const data = input(value);
  const record = measurementRepository(database.db).create(owner, data);
  repo.enqueue(owner, record.id, data, null);
  return record;
}
function retry() {
  vi.advanceTimersByTime(60 * 60_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  database = openDatabase('file::memory:');
  migrate(database.db, { migrationsFolder: './drizzle' });
  database.db
    .insert(user)
    .values({
      id: owner,
      name: 'Synthetic',
      email: 'body@example.test',
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  database.db
    .insert(nutritionSchedule)
    .values({ ownerId: owner, enabled: true, epoch: 1 })
    .run();
  repo = bodyRepository(database);
  remote = {};
  source = {
    summary: vi.fn(async () => structuredClone(remote)),
    range: vi.fn(async () => []),
    create: vi.fn(async (metric: BodyMetric, entry: BodyEntry) => {
      (remote[bodyMetricKeys[metric]] ??= []).push(entry);
    }),
    update: vi.fn(async (id, value) => {
      for (const key of Object.values(bodyMetricKeys))
        for (const entry of remote[key] ?? [])
          if (entry.id === id) entry.value = Number(value);
    }),
  };
});
afterEach(() => {
  database.sqlite.close();
  vi.useRealTimers();
});
it('queues only explicit changed supported fields, supersedes unsent values and ACKs without echo', async () => {
  const record = save();
  expect(repo.due(owner, 1)).toHaveLength(1);
  const next = input('81');
  measurementRepository(database.db).update(owner, record.id, next);
  repo.enqueue(owner, record.id, next, input('80'));
  expect(repo.due(owner, 1)).toHaveLength(1);
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).toHaveBeenCalledTimes(1);
  expect(source.update).not.toHaveBeenCalled();
  expect(repo.status(owner, record.id)[0]?.state).toBe('synced');
  repo.enqueue(owner, record.id, next, next);
  await pullBodyDates(owner, 1, [date], source, repo, fence);
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).toHaveBeenCalledTimes(1);
  expect(database.db.select().from(measurements).all()).toHaveLength(1);
});
it('preserves an uncertain POST and reconciles UUID before a same-snapshot explicit retry', async () => {
  const record = save();
  const uuid = repo.link(repo.due(owner, 1)[0]!.linkId)!.providerId;
  vi.mocked(source.create).mockRejectedValueOnce(new Error('Synthetic outage'));
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(repo.status(owner, record.id)[0]?.state).toBe('uncertain');
  retry();
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).toHaveBeenCalledTimes(1);
  repo.retry(owner, record.id);
  await syncBodyJobs(owner, 1, source, repo, fence, new Set([record.id]));
  expect(source.create).toHaveBeenCalledTimes(2);
  expect(vi.mocked(source.create).mock.calls[1]![1].id).toBe(uuid);
  expect(repo.status(owner, record.id)[0]?.state).toBe('synced');
});
it('process-restart sending performs readback only and found UUID ACKs without another POST', async () => {
  const record = save(),
    job = repo.due(owner, 1)[0]!,
    link = repo.link(job.linkId)!;
  repo.jobState(job.id, 'sending');
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).not.toHaveBeenCalled();
  remote.weight = [
    { id: link.providerId, date: link.providerDateTime, value: 80 },
  ];
  retry();
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(repo.status(owner, record.id)[0]?.state).toBe('synced');
  expect(source.create).not.toHaveBeenCalled();
});
it('retains a newer save during an uncertain create and sends it as PUT after original ACK', async () => {
  const record = save();
  vi.mocked(source.create).mockImplementationOnce(async (metric, entry) => {
    remote[bodyMetricKeys[metric]] = [entry];
    const next = input('82');
    measurementRepository(database.db).update(owner, record.id, next);
    repo.enqueue(owner, record.id, next, input('80'));
    throw new Error('Lost response');
  });
  await syncBodyJobs(owner, 1, source, repo, fence);
  retry();
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).toHaveBeenCalledTimes(1);
  expect(source.update).toHaveBeenCalledTimes(1);
  expect(remote.weight?.[0]?.value).toBe(82);
  expect(
    measurementRepository(database.db)
      .find(owner, record.id)
      ?.values.find((v) => v.metric === 'weight')?.value,
  ).toBe('82');
});
it('pull updates linked metric while preserving notes, neck and same-day observations; repeated pull does not duplicate', async () => {
  const record = save();
  await syncBodyJobs(owner, 1, source, repo, fence);
  measurementRepository(database.db).create(owner, input('77'));
  remote.weight![0]!.value = 79;
  await pullBodyDates(owner, 1, [date, date], source, repo, fence);
  const saved = measurementRepository(database.db).find(owner, record.id)!;
  expect(saved.note).toBe('keep note');
  expect(saved.values).toContainEqual({
    metric: 'neck',
    value: '40',
    unit: 'cm',
  });
  expect(saved.values).toContainEqual({
    metric: 'weight',
    value: '79',
    unit: 'kg',
  });
  expect(database.db.select().from(measurements).all()).toHaveLength(2);
  expect(source.update).not.toHaveBeenCalled();
});
it('preserves conflict remote snapshot and applies only requested measurement on explicit retry', async () => {
  const first = save('80'),
    second = save('70');
  await syncBodyJobs(owner, 1, source, repo, fence);
  for (const record of [first, second]) {
    const old = input(record === first ? '80' : '70'),
      next = input(record === first ? '81' : '71');
    measurementRepository(database.db).update(owner, record.id, next);
    repo.enqueue(owner, record.id, next, old);
  }
  for (const row of remote.weight!) row.value -= 1;
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(repo.status(owner, first.id)[0]?.state).toBe('conflict');
  expect(repo.status(owner, second.id)[0]?.state).toBe('conflict');
  repo.retry(owner, first.id);
  await syncBodyJobs(owner, 1, source, repo, fence, new Set([first.id]));
  expect(source.update).toHaveBeenCalledTimes(1);
  expect(repo.status(owner, second.id)[0]?.state).toBe('conflict');
  expect(
    database.db
      .select()
      .from(yazioBodyOutbox)
      .all()
      .some((j) => j.conflictValue === '79' && j.state === 'done'),
  ).toBe(true);
});
it('date edit creates a new UUID and keeps old remote entry; deletion never resurrects locally', async () => {
  const record = save();
  await syncBodyJobs(owner, 1, source, repo, fence);
  const original = remote.weight![0]!.id;
  const next = { ...input('81'), measuredAt: '2026-10-14' };
  measurementRepository(database.db).update(owner, record.id, next);
  repo.enqueue(owner, record.id, next, input('80'));
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(remote.weight).toHaveLength(2);
  expect(remote.weight![1]!.id).not.toBe(original);
  expect(source.update).not.toHaveBeenCalled();
  repo.detached(owner, record.id);
  measurementRepository(database.db).remove(owner, record.id);
  await pullBodyDates(owner, 1, [date], source, repo, fence);
  expect(database.db.select().from(measurements).all()).toHaveLength(0);
});
it('keeps unrepresentable provider precision raw and reports it without rounding', async () => {
  remote.weight = [
    { id: randomUUID(), date: date + ' 13:21:00', value: 80.12345 },
  ];
  await pullBodyDates(owner, 1, [date], source, repo, fence);
  expect(database.db.select().from(measurements).all()).toHaveLength(0);
  expect(repo.issues(owner)).toEqual([
    { metric: 'weight', date, value: '80.12345' },
  ]);
});
it('connection replacement fences a late response and writes no stale ACK', async () => {
  const record = save();
  vi.mocked(source.create).mockImplementationOnce(async () => {
    database.db
      .update(nutritionSchedule)
      .set({ epoch: 2 })
      .where(eq(nutritionSchedule.ownerId, owner))
      .run();
  });
  await expect(syncBodyJobs(owner, 1, source, repo, fence)).rejects.toThrow(
    'Body connection changed',
  );
  expect(
    repo.link(database.db.select().from(yazioBodyOutbox).all()[0]!.linkId)
      ?.syncedValue,
  ).toBeNull();
  expect(
    measurementRepository(database.db).find(owner, record.id),
  ).toBeDefined();
});
it('disabled connections and existing historical records enqueue nothing', () => {
  database.db.update(nutritionSchedule).set({ enabled: false }).run();
  save();
  expect(database.db.select().from(yazioBodyOutbox).all()).toHaveLength(0);
  database.db.update(nutritionSchedule).set({ enabled: true, epoch: 2 }).run();
  expect(repo.due(owner, 2)).toHaveLength(0);
});
it('newer desired revision cannot POST behind an unresolved ambiguous create', async () => {
  const record = save();
  vi.mocked(source.create).mockRejectedValueOnce(new Error('Lost request'));
  await syncBodyJobs(owner, 1, source, repo, fence);
  const next = input('81');
  measurementRepository(database.db).update(owner, record.id, next);
  repo.enqueue(owner, record.id, next, input('80'));
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).toHaveBeenCalledTimes(1);
  expect(source.update).not.toHaveBeenCalled();
});
it('same provider UUID under a changed metric/date creates a conflict without a write or ACK', async () => {
  const record = save();
  const link = repo.link(repo.due(owner, 1)[0]!.linkId)!;
  remote['circumference.waist'] = [
    { id: link.providerId, date: '2026-10-12 12:00:00', value: 80 },
  ];
  await syncBodyJobs(owner, 1, source, repo, fence);
  expect(source.create).not.toHaveBeenCalled();
  expect(source.update).not.toHaveBeenCalled();
  expect(repo.status(owner, record.id)[0]?.state).toBe('conflict');
  expect(repo.link(link.id)?.syncedValue).toBeNull();
});
it('known UUID moved to another date/metric preserves local record and immutable link', async () => {
  const record = save();
  await syncBodyJobs(owner, 1, source, repo, fence);
  const link = repo.link(
    database.db.select().from(yazioBodyOutbox).all()[0]!.linkId,
  )!;
  repo.importEntry(owner, 1, 'waist', {
    id: link.providerId,
    date: '2026-10-14 12:00:00',
    value: 91,
  });
  expect(repo.link(link.id)?.providerDateTime).toBe(link.providerDateTime);
  expect(repo.link(link.id)?.metric).toBe('weight');
  expect(
    measurementRepository(database.db).find(owner, record.id)?.values,
  ).toEqual(input('80').values);
  expect(repo.status(owner, record.id)[0]?.state).toBe('conflict');
});

it('materializes a never-imported precision observation after provider correction without an outbound intent', async () => {
  const id = randomUUID();
  remote.weight = [{ id, date: date + ' 13:00:00', value: 80.12345 }];
  await pullBodyDates(owner, 1, [date], source, repo, fence);
  expect(database.db.select().from(measurements).all()).toHaveLength(0);
  remote.weight[0]!.value = 80.125;
  await pullBodyDates(owner, 1, [date, date], source, repo, fence);
  expect(database.db.select().from(measurements).all()).toHaveLength(1);
  expect(
    database.db.select().from(measurements).all()[0]!.values[0]!.value,
  ).toBe('80.125');
  expect(repo.issues(owner)).toEqual([]);
  expect(database.db.select().from(yazioBodyOutbox).all()).toHaveLength(0);
  expect(source.create).not.toHaveBeenCalled();
});
it('keeps a deleted UUID tombstone across reconnect epochs and never adopts old write intents', async () => {
  const record = save();
  await syncBodyJobs(owner, 1, source, repo, fence);
  repo.detached(owner, record.id);
  measurementRepository(database.db).remove(owner, record.id);
  database.db.update(nutritionSchedule).set({ epoch: 2 }).run();
  await pullBodyDates(owner, 2, [date], source, repo, async () =>
    repo.assertEpoch(owner, 2),
  );
  expect(database.db.select().from(measurements).all()).toHaveLength(0);
  expect(repo.linked(owner, 2)[0]?.measurementId).toBeNull();
  expect(repo.due(owner, 2)).toHaveLength(0);
  expect(
    database.db
      .select()
      .from(yazioBodyOutbox)
      .all()
      .every((job) => job.epoch === 1),
  ).toBe(true);
  expect(source.create).toHaveBeenCalledTimes(1);
});
