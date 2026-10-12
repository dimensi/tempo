import 'server-only';
import { z } from 'zod';
import type { Yazio } from '@dimensi/yazio';
import { yazioRequest } from './client';
import {
  normalizeHealthSummary,
  normalizeYazioWeight,
} from './health-normalize';

export class YazioHealthReadError extends Error {
  readonly code = 'HEALTH_READ_FAILED';
  constructor() {
    super('YAZIO health read failed');
  }
}

// Supply the existing lease-fenced client; this adapter creates no connection.
// Consumers must fence persistence after awaiting and keep food status separate.
export function yazioHealthUpstream(
  user: Pick<Yazio['user'], 'getWeight' | 'getDailySummary'>,
) {
  const read = async <T>(operation: () => Promise<T>) => {
    try {
      return await yazioRequest(operation);
    } catch {
      throw new YazioHealthReadError();
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
