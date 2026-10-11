import 'server-only';
import { and, eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '@/server/db';
import { measurements } from '@/server/db/schema/measurements';
import type { MeasurementInput } from '@/contracts/measurements';
export function measurementRepository(db = getDatabase().db) {
  const scope = (ownerId: string, id: string) =>
    and(eq(measurements.ownerId, ownerId), eq(measurements.id, id));
  return {
    list: (ownerId: string) =>
      db
        .select()
        .from(measurements)
        .where(eq(measurements.ownerId, ownerId))
        .orderBy(desc(measurements.measuredAt), desc(measurements.id))
        .all(),
    find: (ownerId: string, id: string) =>
      db.select().from(measurements).where(scope(ownerId, id)).get(),
    create: (ownerId: string, input: MeasurementInput) =>
      db
        .insert(measurements)
        .values({ ...input, id: randomUUID(), ownerId })
        .returning()
        .get(),
    update: (ownerId: string, id: string, input: MeasurementInput) =>
      db
        .update(measurements)
        .set(input)
        .where(scope(ownerId, id))
        .returning()
        .get(),
    remove: (ownerId: string, id: string) =>
      db
        .delete(measurements)
        .where(scope(ownerId, id))
        .returning({ id: measurements.id })
        .get(),
  };
}
