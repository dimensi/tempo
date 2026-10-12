import 'server-only';
import {
  transformMateNativeQuerySchema,
  type TransformMateNativeRefresh,
} from '@/contracts/transformmate-native';
import type { TransformMateClient } from '@/server/transformmate/client';
import {
  TransformMateApiError,
  TransformMateResponseError,
  FirebaseRefreshError,
} from '@/server/transformmate/errors';
import { nativeProjection, isNativeTraining } from './native-projection';
import { parseNativeCursor, type NativeRepository } from './native-repository';

interface NativeContext {
  ownerId: string;
  accountScope: string;
  client: Pick<TransformMateClient, 'getTrainings' | 'getTraining'> | null;
  repository: NativeRepository;
  access(): Promise<void>;
  checkConnection(): Promise<void>;
  linkedRemoteIds(): ReadonlySet<number>;
}
type NativeRefreshResult = {
  refresh: TransformMateNativeRefresh;
  nextCursor: string | null;
};
const recent = new Map<string, { at: number; result: NativeRefreshResult }>();
const pending = new Map<string, Promise<NativeRefreshResult>>();

/** Read-only importer. Call after linked-record recovery, inside the owner queue. */
export function nativeService(context: NativeContext) {
  const guard = async () => {
    await context.access();
    await context.checkConnection();
    await context.access();
  };
  const list = async (input: unknown) => {
    const query = transformMateNativeQuerySchema.parse(input);
    await guard();
    return context.repository.list(
      context.ownerId,
      context.accountScope,
      query,
      context.linkedRemoteIds(),
    );
  };
  const refresh = async (input: unknown): Promise<NativeRefreshResult> => {
    const query = transformMateNativeQuerySchema.parse(input);
    const cursor = parseNativeCursor(query.cursor);
    await guard();
    if (!context.client)
      return {
        refresh: { status: 'unavailable', checkedAt: null, errorCode: null },
        nextCursor: null,
      };
    const key = JSON.stringify([
      context.ownerId,
      context.accountScope,
      query.from,
      query.to,
      query.cursor ?? '',
      Math.min(query.limit, 20),
    ]);
    const existing = pending.get(key);
    if (existing) {
      const result = await existing;
      await guard();
      return result;
    }
    const cached = recent.get(key);
    if (cached && Date.now() - cached.at < 60_000)
      return cached.result.refresh.status === 'fresh'
        ? {
            ...cached.result,
            refresh: { ...cached.result.refresh, status: 'cooldown' },
          }
        : cached.result;
    const client = context.client;
    const run = async (): Promise<NativeRefreshResult> => {
      const checkedAt = new Date().toISOString();
      let errorCode: TransformMateNativeRefresh['errorCode'] = null;
      let nextCursor: string | null = null;
      try {
        const response = await client.getTrainings();
        await guard();
        const ids = context.linkedRemoteIds();
        const candidates = response.body
          .filter(
            (summary) =>
              summary.date >= query.from &&
              summary.date <= query.to &&
              isNativeTraining(summary, ids) &&
              (!cursor ||
                summary.date < cursor.date ||
                (summary.date === cursor.date && summary.id < cursor.id)),
          )
          .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        const seen = new Set<number>();
        const bounded = candidates
          .filter(
            (summary) => !seen.has(summary.id) && Boolean(seen.add(summary.id)),
          )
          .slice(0, Math.min(query.limit, 20));
        const last = bounded.at(-1);
        if (last && candidates.length > bounded.length)
          nextCursor = `${last.date}:${last.id}`;
        for (const summary of bounded) {
          await guard();
          try {
            const detail = (await client.getTraining(summary.id)).body;
            await guard();
            if (detail.id !== summary.id)
              throw new Error('Invalid native detail');
            if (!isNativeTraining(detail, context.linkedRemoteIds())) continue;
            const snapshot = nativeProjection(detail);
            await guard();
            if (
              !context.repository.save(
                context.ownerId,
                context.accountScope,
                snapshot,
                checkedAt,
              )
            )
              throw new Error('Native snapshot changed');
          } catch (error) {
            await guard();
            errorCode = classify(error);
          }
        }
      } catch (error) {
        await guard();
        errorCode = classify(error);
      }
      return {
        refresh: {
          status: errorCode ? 'error' : 'fresh',
          checkedAt,
          errorCode,
        },
        nextCursor,
      };
    };
    const work = run();
    pending.set(key, work);
    try {
      const result = await work;
      await guard();
      if (recent.size >= 256) recent.delete(recent.keys().next().value!);
      recent.set(key, { at: Date.now(), result });
      return result;
    } finally {
      pending.delete(key);
    }
  };
  return { list, refresh };
}
function classify(
  error: unknown,
): NonNullable<TransformMateNativeRefresh['errorCode']> {
  if (
    error instanceof FirebaseRefreshError ||
    (error instanceof TransformMateApiError &&
      [401, 403].includes(error.status))
  )
    return 'reauth_required';
  if (error instanceof TransformMateApiError && error.status === 429)
    return 'rate_limited';
  if (
    error instanceof TransformMateResponseError ||
    !(error instanceof TransformMateApiError)
  )
    return 'invalid_data';
  return 'upstream_error';
}
