import { expect, it, vi } from 'vitest';
import { createTransformMateClient } from '@/server/transformmate/client';
import { trainingDetailFixture } from '../fixtures/transformmate';
import { transformMateTrainingDetailSchema } from '@/server/transformmate/schemas';
import { trainingWriteSnapshot } from '@/server/transformmate/write-snapshot';
vi.mock('server-only', () => ({}));
it.each([401, 403, 500])(
  'direct guarded PATCH HTTP %s never refreshes/replays or automatically GETs',
  async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'synthetic-token' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = { getIdToken: vi.fn(async () => 'synthetic-token') };
    const client = createTransformMateClient({
      baseUrl: 'https://example.test/ipt/api/v1',
      tokenProvider: provider,
      fetch: request,
    });
    const body = trainingWriteSnapshot(
      transformMateTrainingDetailSchema.parse(trainingDetailFixture()),
    );
    await expect(client.updateTrainingOnce(101, body)).rejects.toMatchObject({
      status,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]?.method).toBe('PATCH');
    expect(provider.getIdToken).toHaveBeenCalledTimes(1);
  },
);
it('checks current authorization after token acquisition and before sending PATCH', async () => {
  let revoked = false;
  const request = vi.fn<typeof fetch>();
  const client = createTransformMateClient({
    baseUrl: 'https://example.test/ipt/api/v1',
    tokenProvider: {
      getIdToken: async () => {
        revoked = true;
        return 'synthetic-token';
      },
    },
    fetch: request,
  });
  const guard = async () => {
    if (revoked) throw new Error('Permission revoked');
  };
  const body = trainingWriteSnapshot(
    transformMateTrainingDetailSchema.parse(trainingDetailFixture()),
  );
  await expect(client.updateTrainingOnce(101, body, guard)).rejects.toThrow(
    'Permission revoked',
  );
  expect(request).not.toHaveBeenCalled();
});
