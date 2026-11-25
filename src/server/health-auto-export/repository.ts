import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, getTableColumns, gte, inArray, lte } from 'drizzle-orm';
import type {
  HealthAutoExportErrorCode,
  HealthAutoExportMetric,
  HealthAutoExportSample,
  HealthAutoExportStatus,
} from '@/contracts/health-auto-export';
import { getDatabase } from '@/server/db';
import { user } from '@/server/db/schema';
import {
  healthAutoExportConnections as connections,
  healthAutoExportSamples as samples,
} from '@/server/db/schema/health-auto-export';
import { readServerEnv } from '@/server/env';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function healthAutoExportEndpoint(): string | null {
  const configured = new URL(readServerEnv().BETTER_AUTH_URL);
  return configured.protocol === 'https:'
    ? new URL('/api/health/auto-export', configured.origin).href
    : null;
}

export function readHealthAutoExportStatus(
  ownerId: string,
): HealthAutoExportStatus {
  const connection = getDatabase()
    .db.select()
    .from(connections)
    .where(eq(connections.ownerId, ownerId))
    .get();
  return {
    connected: Boolean(connection?.tokenDigest),
    endpoint: healthAutoExportEndpoint(),
    lastAttemptAt: connection?.lastAttemptAt ?? null,
    lastSuccessAt: connection?.lastSuccessAt ?? null,
    lastInserted: connection?.lastInserted ?? null,
    lastErrorCode: connection?.lastErrorCode ?? null,
  };
}

export function issueHealthAutoExportToken(ownerId: string) {
  const token = `hae_${randomBytes(32).toString('base64url')}`;
  const change = { tokenDigest: sha256(token), lastErrorCode: null };
  getDatabase()
    .db.insert(connections)
    .values({ ownerId, ...change })
    .onConflictDoUpdate({ target: connections.ownerId, set: change })
    .run();
  return token;
}

export function revokeHealthAutoExportToken(ownerId: string) {
  getDatabase()
    .db.update(connections)
    .set({ tokenDigest: null })
    .where(eq(connections.ownerId, ownerId))
    .run();
}

type ImportCredential = { ownerId: string; tokenDigest: string };

export function authenticateHealthAutoExport(
  authorization: string | null,
): ImportCredential | null {
  const token = /^Bearer (hae_[A-Za-z0-9_-]{43})$/i.exec(
    authorization ?? '',
  )?.[1];
  if (!token) return null;
  const tokenDigest = sha256(token);
  const connection = getDatabase()
    .db.select({ ownerId: connections.ownerId })
    .from(connections)
    .innerJoin(user, eq(user.id, connections.ownerId))
    .where(
      and(eq(connections.tokenDigest, tokenDigest), eq(user.role, 'OWNER')),
    )
    .get();
  return connection ? { ...connection, tokenDigest } : null;
}

function sameCredential(credential: ImportCredential) {
  return and(
    eq(connections.ownerId, credential.ownerId),
    eq(connections.tokenDigest, credential.tokenDigest),
  );
}

export function recordHealthAutoExportFailure(
  credential: ImportCredential,
  error: HealthAutoExportErrorCode,
) {
  return (
    getDatabase()
      .db.update(connections)
      .set({
        lastAttemptAt: new Date().toISOString(),
        lastErrorCode: error,
      })
      .where(sameCredential(credential))
      .run().changes > 0
  );
}

function sampleKey(sample: HealthAutoExportSample) {
  const source = sample.source?.normalize('NFC').replace(/\s+/g, ' ') ?? null;
  return sha256(
    JSON.stringify([
      sample.metric,
      sample.startAt,
      sample.endAt,
      sample.stage,
      source,
    ]),
  );
}

export function saveHealthAutoExportSamples(
  credential: ImportCredential,
  batch: HealthAutoExportSample[],
): number | null {
  const rows = batch.map((sample) => ({
    ...sample,
    ownerId: credential.ownerId,
    sampleKey: sampleKey(sample),
  }));

  return getDatabase().db.transaction(
    (tx) => {
      const authorized = tx
        .select({ ownerId: connections.ownerId })
        .from(connections)
        .innerJoin(user, eq(user.id, connections.ownerId))
        .where(and(sameCredential(credential), eq(user.role, 'OWNER')))
        .get();
      if (!authorized) return null;

      let inserted = 0;
      // Bound SQL parameters per statement and keep the delivery atomic.
      for (let offset = 0; offset < rows.length; offset += 500) {
        inserted += tx
          .insert(samples)
          .values(rows.slice(offset, offset + 500))
          .onConflictDoNothing({
            target: [samples.ownerId, samples.sampleKey],
          })
          .run().changes;
      }
      const now = new Date().toISOString();
      tx.update(connections)
        .set({
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastInserted: inserted,
          lastErrorCode: null,
        })
        .where(sameCredential(credential))
        .run();
      return inserted;
    },
    { behavior: 'immediate' },
  );
}

const {
  ownerId: sampleOwner,
  sampleKey: storedSampleKey,
  ...sampleFields
} = getTableColumns(samples);

// The caller authorizes the owner. Local bounds include intervals spanning midnight.
export function readHealthAutoExportSamples(
  ownerId: string,
  range: { from: string; to: string },
  options?: { limit?: number; metrics?: readonly HealthAutoExportMetric[] },
): HealthAutoExportSample[] {
  return getDatabase()
    .db.select(sampleFields)
    .from(samples)
    .where(
      and(
        eq(sampleOwner, ownerId),
        lte(samples.startDate, range.to),
        gte(samples.endDate, range.from),
        options?.metrics ? inArray(samples.metric, options.metrics) : undefined,
      ),
    )
    .orderBy(asc(samples.startAt), asc(storedSampleKey))
    .limit(options?.limit ?? -1)
    .all();
}
