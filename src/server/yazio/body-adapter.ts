import 'server-only';
import { z } from 'zod';
import { createYazioAuth, type YazioTokenStore } from './client';
import { retryYazioRead } from '@/server/yazio/read-request';
import { YazioReadFailure } from '@/server/yazio/sync-diagnostics';
import {
  bodySummarySchema,
  bodyRangeSchema,
  bodyMetricKeys,
  bodyEntrySchema,
  type BodyMetric,
  type BodyEntry,
} from '@/contracts/yazio-body';
export interface BodyUpstream {
  summary(date: string): Promise<ReturnType<typeof bodySummarySchema.parse>>;
  range(
    metric: BodyMetric,
    from: string,
    to: string,
  ): Promise<ReturnType<typeof bodyRangeSchema.parse>>;
  create(metric: BodyMetric, entry: BodyEntry): Promise<void>;
  update(id: string, value: string): Promise<void>;
}
// Static APK contract: classes5.dex Lqm2 d/c/h/g. No body DELETE exposed.
export async function bodyUpstream(
  store: YazioTokenStore,
): Promise<BodyUpstream> {
  const auth = await createYazioAuth(store);
  async function request(path: string, method = 'GET', body?: unknown) {
    await store.assertCurrent?.();
    const token = await auth.authenticate();
    await store.assertCurrent?.();
    const send = async () => {
      // Fetch is aborted before the bounded request can leave its single-process slot.
      const response = await fetch(`https://yzapi.yazio.com/v20${path}`, {
        method,
        headers: {
          'User-Agent':
            'YAZIO/26.30.1 (com.yazio.ios.YAZIO; build:2607271240; iOS 27.0.0) Ktor',
          Authorization: `Bearer ${token.access_token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(method === 'GET' ? 20000 : 30000),
        redirect: 'error',
        cache: 'no-store',
      });
      await store.assertCurrent?.();
      if (!response.ok) {
        await response.body?.cancel();
        throw new YazioReadFailure(
          { category: 'HTTP', status: response.status, retryable: false },
          1,
        );
      }
      const result =
        method === 'GET'
          ? await response.json()
          : await response.arrayBuffer().then(() => undefined);
      await store.assertCurrent?.();
      return result;
    };
    return method === 'GET'
      ? retryYazioRead(send, { operation: 'body' }, () =>
          store.assertCurrent?.(),
        )
      : send();
  }
  return {
    summary: async (date) =>
      bodySummarySchema.parse(
        await request(`/user/bodyvalues?date=${z.iso.date().parse(date)}`),
      ),
    range: async (metric, from, to) =>
      bodyRangeSchema.parse(
        await request(
          `/user/bodyvalues/${bodyMetricKeys[metric]}?start=${z.iso.date().parse(from)}&end=${z.iso.date().parse(to)}`,
        ),
      ),
    create: async (metric, entry) => {
      await request('/user/bodyvalues', 'POST', {
        [bodyMetricKeys[metric]]: [bodyEntrySchema.parse(entry)],
      });
    },
    update: async (id, value) => {
      await request(`/user/bodyvalues/${z.uuid().parse(id)}`, 'PUT', {
        value: z.number().positive().max(9999.999).parse(Number(value)),
      });
    },
  };
}
