import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/guards', () => ({
  authorize: async () => ({ ok: true }),
}));
vi.mock('@/server/storage', () => ({ getObjectStorage: vi.fn() }));
vi.mock('@/server/workouts/video-validation', () => ({
  validateWorkoutVideo: vi.fn(),
}));
vi.mock('@/server/workouts/index', () => ({
  WorkoutError: class extends Error {
    constructor(public status: number) {
      super();
    }
  },
  WorkoutAccessError: class extends Error {},
}));
vi.mock('@/server/workouts/http', () => ({
  checkWorkoutOrigin: vi.fn(),
  readWorkoutJson: (request: Request) => request.json(),
}));
vi.mock('@/server/db', () => ({
  getDatabase: () => ({
    db: {
      select: () => ({
        from: (table: { id: { name: string } }) => ({
          where: () => ({
            get: () =>
              table.id.name === 'id'
                ? state.rows[0]
                : {
                    data: {
                      status: 'completed',
                      exercises: [
                        { id: '00000000-0000-4000-8000-000000000002' },
                      ],
                    },
                  },
            all: () => state.rows,
          }),
        }),
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => ({
          returning: () => ({
            get: () => {
              state.rows.push(value);
              return value;
            },
          }),
        }),
      }),
    },
  }),
}));
// Distinguish session and video reads without a database or storage connection.
vi.mock('@/server/db/schema/workouts', () => ({
  workoutSessions: { id: { name: 'session' }, ownerId: {} },
}));
vi.mock('@/server/db/schema/workout-videos', () => ({
  workoutVideos: { id: { name: 'id' }, ownerId: {} },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));
const { createVideo } = await import('@/server/workouts/videos');
const id = '00000000-0000-4000-8000-000000000003';
const input = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  exerciseId: '00000000-0000-4000-8000-000000000002',
  size: 32,
  duration: 1.5,
};
const request = (body = input, key = id) =>
  new Request('https://test/api?ownerId=owner', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.rows = [];
});
it('reuses a committed upload when the create response was lost, including concurrent retry', async () => {
  const first = await createVideo(request());
  const retries = await Promise.all([
    createVideo(request()),
    createVideo(request()),
  ]);
  expect(retries.map((row) => row.id)).toEqual([first.id, first.id]);
  expect(first.id).toBe(id);
  expect(state.rows).toHaveLength(1);
});
it('rejects reuse with different media or another owner without creating a row', async () => {
  await createVideo(request());
  await expect(
    createVideo(request({ ...input, size: 64 })),
  ).rejects.toMatchObject({ status: 409 });
  state.rows[0]!.ownerId = 'another-owner';
  await expect(createVideo(request())).rejects.toMatchObject({ status: 409 });
  expect(state.rows).toHaveLength(1);
});
it('rejects an invalid idempotency key before a write', async () => {
  await expect(createVideo(request(input, '../invalid'))).rejects.toThrow();
  expect(state.rows).toHaveLength(0);
});
