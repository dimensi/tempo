import 'server-only';
import { bodyMetricKeys, type BodyMetric } from '@/contracts/yazio-body';
import type { BodyUpstream } from '@/server/yazio/body-adapter';
import type { bodyRepository, BodyJob } from '@/server/yazio/body-repository';
const delay = (attempt: number) =>
  Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempt, 7));
export async function syncBodyJobs(
  ownerId: string,
  epoch: number,
  source: BodyUpstream,
  repo: ReturnType<typeof bodyRepository>,
  assertCurrent: () => Promise<void>,
  manualMeasurements: ReadonlySet<string> = new Set(),
) {
  for (const job of repo.due(ownerId, epoch, manualMeasurements.size > 0)) {
    await assertCurrent();
    const link = repo.link(job.linkId);
    if (!link || link.ownerId !== ownerId || link.epoch !== epoch)
      throw new Error('Body scope changed');
    const manual =
      link.measurementId !== null && manualMeasurements.has(link.measurementId);
    if (
      (job.state === 'conflict' && !manual) ||
      (!manual && job.state === 'failed' && job.attempt >= 3) ||
      repo.blocked(job)
    )
      continue;
    if (!link.measurementId) {
      if (job.state !== 'uncertain' && job.state !== 'sending')
        repo.jobState(job.id, 'cancelled');
      if (job.state !== 'uncertain' && job.state !== 'sending') continue;
    }
    try {
      // Every attempt reads the complete date summary first, including explicit retry.
      const summary = await source.summary(link.providerDateTime.slice(0, 10));
      await assertCurrent();
      const matches = Object.entries(bodyMetricKeys).flatMap(([metric, key]) =>
        (summary[key] ?? [])
          .filter((entry) => entry.id === link.providerId)
          .map((entry) => ({ metric, entry })),
      );
      const remote = matches[0]?.entry;
      if (
        matches.length > 1 ||
        matches.some(
          (match) =>
            match.metric !== link.metric ||
            match.entry.date !== link.providerDateTime,
        )
      ) {
        repo.jobState(job.id, 'conflict', {
          conflictValue: JSON.stringify(matches),
        });
        continue;
      }
      if (!link.measurementId) {
        if (remote && remote.value === Number(job.value))
          repo.acknowledge(job, remote);
        else repo.jobState(job.id, 'cancelled');
        continue;
      }
      if (remote && remote.date !== link.providerDateTime) {
        repo.jobState(job.id, 'conflict', {
          conflictValue: JSON.stringify({
            date: remote.date,
            metric: link.metric,
            value: remote.value,
          }),
        });
        continue;
      }
      if (remote) {
        repo.remote(link.id, String(remote.value));
        if (remote.value === Number(job.value)) {
          repo.acknowledge(job, remote);
          continue;
        }
        if ((job.state === 'sending' || job.state === 'uncertain') && !manual) {
          repo.jobState(job.id, 'conflict', {
            conflictValue: String(remote!.value),
          });
          continue;
        }
        if (
          link.syncedValue !== null &&
          remote.value !== Number(link.syncedValue) &&
          !manual
        ) {
          repo.jobState(job.id, 'conflict', {
            conflictValue: String(remote!.value),
          });
          continue;
        }
      } else if (
        (job.state === 'sending' || job.state === 'uncertain') &&
        !manual
      ) {
        repo.jobState(job.id, 'uncertain', {
          attempt: job.attempt + 1,
          nextAttemptAt: Date.now() + delay(job.attempt),
        });
        continue;
      } else if (link.syncedValue !== null) {
        repo.jobState(job.id, 'conflict', {
          conflictValue: link.remoteValue,
        });
        continue;
      } // Missing remote is not deletion.
      if (repo.job(job.id)?.state === 'cancelled') continue;
      if (!repo.link(link.id)?.measurementId) {
        repo.jobState(job.id, 'cancelled');
        continue;
      }
      repo.jobState(
        job.id,
        'sending',
        remote
          ? {
              conflictValue:
                remote.value !== Number(job.value)
                  ? String(remote.value)
                  : null,
            }
          : {},
      );
      await assertCurrent();
      if (remote) await source.update(link.providerId, job.value);
      else
        await source.create(link.metric, {
          id: link.providerId,
          date: link.providerDateTime,
          value: Number(job.value),
        });
      await assertCurrent();
      const check = await source.summary(link.providerDateTime.slice(0, 10));
      await assertCurrent();
      const confirmed = check[bodyMetricKeys[link.metric]]?.find(
        (entry) =>
          entry.id === link.providerId && entry.date === link.providerDateTime,
      );
      const other = Object.entries(bodyMetricKeys).some(
        ([metric, key]) =>
          metric !== link.metric &&
          (check[key] ?? []).some((entry) => entry.id === link.providerId),
      );
      if (confirmed && !other && confirmed.value === Number(job.value))
        repo.acknowledge(job, confirmed);
      else
        repo.jobState(job.id, confirmed ? 'conflict' : 'uncertain', {
          attempt: job.attempt + 1,
          nextAttemptAt: Date.now() + delay(job.attempt),
        });
    } catch {
      await assertCurrent();
      // Once sending was persisted, a transport failure is ambiguous, including PUT.
      const sent = repo.job(job.id)?.state === 'sending';
      const state: BodyJob['state'] =
        sent || job.state === 'uncertain' || job.state === 'sending'
          ? 'uncertain'
          : 'failed';
      repo.jobState(job.id, state, {
        attempt: job.attempt + 1,
        nextAttemptAt: Date.now() + delay(job.attempt),
      });
    }
  }
}
export async function pullBodyDates(
  ownerId: string,
  epoch: number,
  dates: string[],
  source: BodyUpstream,
  repo: ReturnType<typeof bodyRepository>,
  assertCurrent: () => Promise<void>,
) {
  for (const date of dates) {
    await assertCurrent();
    try {
      const summary = await source.summary(date);
      await assertCurrent();
      for (const [metric, key] of Object.entries(bodyMetricKeys))
        for (const entry of summary[key] ?? []) {
          await assertCurrent();
          repo.importEntry(ownerId, epoch, metric as BodyMetric, entry);
        }
    } catch {
      await assertCurrent();
    } // Existing local data survives an incomplete read.
  }
}
