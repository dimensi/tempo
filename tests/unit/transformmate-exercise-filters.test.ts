import { expect, it, vi } from 'vitest';
import { createTransformMateClient } from '@/server/transformmate/client';
vi.mock('server-only', () => ({}));
const exercise = {
  id: 6,
  name: 'Demo exercise',
  metrics: [{ id: 3, key: 'weight' }],
};
const groups = [
  {
    id: 13,
    name: 'Demo group',
    image: null,
    muscles: [20],
    common_muscle_group: { id: 3, name: 'Demo common group' },
  },
];
const page = {
  count: 10,
  next: 'https://untrusted.example.test/next',
  previous: null,
  results: [exercise],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const tokenProvider = { getIdToken: vi.fn().mockResolvedValue('demo-token') };
  return {
    client: createTransformMateClient({
      baseUrl: 'https://example.test/ipt/api/v1',
      fetch,
      tokenProvider,
    }),
    fetch,
    tokenProvider,
  };
}
it('serializes Unicode group names as CSV and safely escapes query delimiters', async () => {
  const { client, fetch } = setup(json([exercise]));
  const result = await client.listExercises({
    commonMuscleGroup: 'Ноги',
    muscleGroups: ['Квадрицепс', 'Задняя поверхность бедра'],
    search: 'жим & тяга',
  });
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/ipt/api/v1/exercises/');
  expect([...url.searchParams]).toEqual([
    ['common_muscle_group', 'Ноги'],
    ['muscle_group', 'Квадрицепс,Задняя поверхность бедра'],
    ['search', 'жим & тяга'],
  ]);
  expect(result.body).toEqual([exercise]);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: 'GET',
    headers: { Authorization: 'JWT demo-token' },
  });
});
it('requests one explicit page and never follows upstream pagination URLs', async () => {
  const { client, fetch } = setup(json(page));
  expect(
    (
      await client.listExercisePage({
        muscleGroups: ['Квадрицепс'],
        limit: 2,
        offset: 2,
      })
    ).body,
  ).toEqual(page);
  const url = new URL(String(fetch.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/ipt/api/v1/exercises/temporary_exercises/');
  expect(url.searchParams.get('limit')).toBe('2');
  expect(url.searchParams.get('offset')).toBe('2');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not change the full catalog operation or send empty filters', async () => {
  const { client, fetch } = setup(json([]), json([]));
  await client.listExercises();
  await client.listExercises({ muscleGroups: [], search: '' });
  expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
    'https://example.test/ipt/api/v1/exercises/',
    'https://example.test/ipt/api/v1/exercises/',
  ]);
});
it('returns typed groups with both group IDs and muscle IDs', async () => {
  const { client, fetch } = setup(json(groups));
  expect((await client.listMuscleGroups()).body).toEqual(groups);
  expect(String(fetch.mock.calls[0]?.[0])).toBe(
    'https://example.test/ipt/api/v1/exercises/muscle_groups/',
  );
});
it.each([
  { muscleGroups: [13] },
  { muscleGroups: [''] },
  { muscleGroups: ['a,b'] },
  { commonMuscleGroup: ['a', 'b'] },
  { limit: 0 },
  { limit: 51 },
  { offset: -1 },
  { offset: 1.5 },
  { unexpected: 'demo-token' },
])('rejects invalid input before network: %j', (input) => {
  const { client, fetch } = setup();
  expect(() => client.listExercisePage(input as never)).toThrow(
    'Invalid TransformMate exercise filters',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['listExercises', 'listExercisePage', 'listMuscleGroups'] as const)(
  'refreshes once on 401 for %s',
  async (method) => {
    const body =
      method === 'listExercises'
        ? [exercise]
        : method === 'listExercisePage'
          ? page
          : groups;
    const { client, fetch, tokenProvider } = setup(json({}, 401), json(body));
    await client[method]();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(tokenProvider.getIdToken.mock.calls).toEqual([
      [],
      [{ forceRefresh: true }],
    ]);
  },
);
it.each(['listExercises', 'listExercisePage', 'listMuscleGroups'] as const)(
  'does not retry 403 and redacts credentials for %s',
  async (method) => {
    const { client, fetch } = setup(
      json({ detail: 'demo-token', refresh_token: 'private-refresh' }, 403),
    );
    const error = await client[method]().catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 403 });
    expect(JSON.stringify(error)).not.toContain('demo-token');
    expect(JSON.stringify(error)).not.toContain('private-refresh');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.each(['listExercisePage', 'listMuscleGroups'] as const)(
  'rejects malformed %s responses without exposing values',
  async (method) => {
    const { client } = setup(json({ wrong: 'demo-token' }));
    const error = await client[method]().catch((value: unknown) => value);
    expect(error).toMatchObject({ name: 'TransformMateResponseError' });
    expect(JSON.stringify(error)).not.toContain('demo-token');
  },
);

it('does not expose query values in response validation errors', async () => {
  const { client } = setup(json({ wrong: true }));
  const error = await client
    .listExercisePage({ search: 'demo-token' })
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ endpoint: 'exercises/temporary_exercises/' });
  expect(JSON.stringify(error)).not.toContain('demo-token');
  expect(String(error)).not.toContain('demo-token');
});
