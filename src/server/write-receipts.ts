import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabase } from '@/server/db';
import { offlineWriteReceipts } from '@/server/db/schema/offline-writes';
export class WriteConflict extends Error {
  readonly status = 409;
}
export const writeFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Call only with synchronous domain work: version, mutation and receipt commit together. */
export function withWriteReceipt<T>(
  ownerId: string,
  namespace: string,
  requestId: string,
  input: unknown,
  save: () => T,
): T {
  const { db, sqlite } = getDatabase();
  const operationId = `${namespace}:${requestId}`;
  const fingerprint = writeFingerprint(input);
  return sqlite.transaction(() => {
    const previous = db
      .select()
      .from(offlineWriteReceipts)
      .where(
        and(
          eq(offlineWriteReceipts.ownerId, ownerId),
          eq(offlineWriteReceipts.operationId, operationId),
        ),
      )
      .get();
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new WriteConflict();
      return JSON.parse(previous.result) as T;
    }
    const saved = save();
    db.insert(offlineWriteReceipts)
      .values({
        ownerId,
        operationId,
        fingerprint,
        result: JSON.stringify(saved),
      })
      .run();
    return saved;
  })();
}
