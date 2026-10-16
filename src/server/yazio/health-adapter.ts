import 'server-only';
import { z } from 'zod';
import {
  normalizeHealthSummary,
  normalizeYazioWeight,
} from './health-normalize';

export class YazioHealthReadError extends Error {
  readonly code = 'HEALTH_READ_FAILED';
  constructor(options?: ErrorOptions) {
    super('YAZIO health read failed', options);
  }
}

// Supply the existing lease-fenced client; this adapter creates no connection.
// Consumers must fence persistence after awaiting and keep food status separate.
export function yazioHealthUpstream(user: {
  getWeight(options: { date: string }): Promise<unknown>;
  getDailySummary(options: { date: string }): Promise<unknown>;
}) {
  const read = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (cause) {
      throw new YazioHealthReadError({ cause });
    }
  };
  return {
    summary: (date: string) =>
      read(async () =>
        normalizeHealthSummary(
          await user.getDailySummary({ date: z.iso.date().parse(date) }),
          date,
        ),
      ),
    weight: (date: string, unitContext: string | null) =>
      read(async () =>
        normalizeYazioWeight(
          await user.getWeight({ date: z.iso.date().parse(date) }),
          unitContext,
        ),
      ),
  };
}
