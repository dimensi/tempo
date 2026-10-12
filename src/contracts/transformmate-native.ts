import { z } from 'zod';

const remoteId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const order = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: true });

/** Read-only provider projection; never a local plan or publication intent. */
export const transformMateNativeSnapshotSchema = z.object({
  source: z.literal('transformmate'),
  remoteTrainingId: remoteId,
  date: z.iso.date(),
  title: z.string().max(500),
  progress: z.string().max(100),
  started: timestamp.nullable(),
  finished: timestamp.nullable(),
  remoteUpdatedAt: timestamp,
  exercises: z
    .array(
      z.object({
        protocolId: remoteId,
        protocolOrder: order,
        remoteExerciseId: remoteId,
        exerciseId: remoteId,
        order,
        name: z.string().max(500),
        comment: z.string().max(4000),
        metrics: z
          .array(
            z.object({
              type: z.enum(['plan', 'fact']),
              sets: z
                .array(
                  z.object({
                    order,
                    done: z.boolean().nullable(),
                    metrics: z
                      .array(
                        z.object({
                          key: z.string().max(100),
                          name: z.string().max(500),
                          unit: z.string().max(100),
                          type: z.string().max(100),
                          values: z.array(z.string().max(1000)).max(100),
                        }),
                      )
                      .max(50),
                  }),
                )
                .max(100),
            }),
          )
          .max(10),
      }),
    )
    .max(100),
});
export const transformMateNativeItemSchema =
  transformMateNativeSnapshotSchema.extend({
    fetchedAt: timestamp,
  });
export const transformMateNativePageSchema = z.object({
  items: z.array(transformMateNativeItemSchema).max(50),
  nextCursor: z.string().max(256).nullable(),
});
export const transformMateNativeRefreshSchema = z.object({
  status: z.enum(['idle', 'fresh', 'error', 'unavailable', 'cooldown']),
  checkedAt: timestamp.nullable(),
  errorCode: z
    .enum(['upstream_error', 'reauth_required', 'invalid_data', 'rate_limited'])
    .nullable(),
});
export type TransformMateNativeSnapshot = z.infer<
  typeof transformMateNativeSnapshotSchema
>;
export type TransformMateNativeItem = z.infer<
  typeof transformMateNativeItemSchema
>;
export type TransformMateNativePage = z.infer<
  typeof transformMateNativePageSchema
>;
export type TransformMateNativeRefresh = z.infer<
  typeof transformMateNativeRefreshSchema
>;

/** Local filtering/pagination: upstream exposes a complete summary array. */
export const transformMateNativeQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => value.from <= value.to, {
    message: 'Invalid date range',
  })
  .refine(
    (value) =>
      Date.parse(`${value.to}T00:00:00Z`) -
        Date.parse(`${value.from}T00:00:00Z`) <=
      366 * 24 * 60 * 60 * 1000,
    { message: 'Date range is too large' },
  );
export type TransformMateNativeQuery = z.infer<
  typeof transformMateNativeQuerySchema
>;
