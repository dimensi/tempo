import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { nativeService } from '@/server/workouts/transformmate/native-service';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import type { TransformMateClient } from '@/server/transformmate/client';

function setup() {
  const detail = trainingDetailFixture();
  const client = {
    getTrainings: vi
      .fn()
      .mockResolvedValue({ body: [trainingSummaryFixture()] }),
    getTraining: vi.fn().mockResolvedValue({ body: detail }),
  };
  const repository = {
    save: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue({ items: [], nextCursor: null }),
  };
  const context = {
    ownerId: crypto.randomUUID(),
    accountScope: 'a'.repeat(64),
    client: client as unknown as Pick<
      TransformMateClient,
      'getTrainings' | 'getTraining'
    > | null,
    repository,
    access: vi.fn().mockResolvedValue(undefined),
    checkConnection: vi.fn().mockResolvedValue(undefined),
    checkBinding: vi.fn(),
    linkedRemoteIds: () => new Set<number>(),
  };
  return { client, repository, context, service: nativeService(context) };
}
const query = { from: '2026-01-01', to: '2026-01-31', limit: 50 };
describe('native readonly importer', () => {
  it('rejects unbounded date windows before provider reads', async () => {
    const { service, client } = setup();
    await expect(
      service.refresh({ from: '2025-01-01', to: '2026-12-31', limit: 20 }),
    ).rejects.toThrow();
    expect(client.getTrainings).not.toHaveBeenCalled();
  });
  it('deduplicates provider IDs and coalesces refresh without write methods', async () => {
    const { service, client, repository } = setup();
    client.getTrainings.mockResolvedValue({
      body: [trainingSummaryFixture(), trainingSummaryFixture()],
    });
    const [first, second] = await Promise.all([
      service.refresh(query),
      service.refresh(query),
    ]);
    expect(first.refresh.status).toBe('fresh');
    expect(second.refresh.status).toBe('fresh');
    expect(client.getTrainings).toHaveBeenCalledTimes(1);
    expect(client.getTraining).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(
      repository.save.mock.calls[0]![2].exercises[0].metrics.map(
        (m: { type: string }) => m.type,
      ),
    ).toEqual(['plan', 'fact']);
  });
  it('bounds details and excludes linked IDs and app markers before fetching', async () => {
    const { service, client, context } = setup();
    context.linkedRemoteIds = () => new Set([1]);
    client.getTrainings.mockResolvedValue({
      body: Array.from({ length: 30 }, (_, i) => ({
        ...trainingSummaryFixture(),
        id: i + 1,
        description: i === 1 ? '[yazio-dashboard:marker]' : '',
      })),
    });
    client.getTraining.mockImplementation(async (id: number) => ({
      body: { ...trainingDetailFixture(), id },
    }));
    await service.refresh(query);
    expect(client.getTraining).toHaveBeenCalledTimes(20);
    expect(client.getTraining).not.toHaveBeenCalledWith(1);
    expect(client.getTraining).not.toHaveBeenCalledWith(2);
  });
  it('retains cache and reports failed or incomplete details separately from empty history', async () => {
    const { service, client, repository } = setup();
    client.getTraining.mockRejectedValue(new Error('Malformed detail'));
    expect(await service.refresh(query)).toMatchObject({
      refresh: { status: 'error', errorCode: 'invalid_data' },
    });
    expect(await service.refresh(query)).toMatchObject({
      refresh: { status: 'error', errorCode: 'invalid_data' },
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(await service.list(query)).toEqual({ items: [], nextCursor: null });
    const empty = setup();
    empty.client.getTrainings.mockResolvedValue({ body: [] });
    expect((await empty.service.refresh(query)).refresh.status).toBe('fresh');
  });
  it('fences deferred responses after revocation and exposes no writes when disconnected', async () => {
    const { service, client, context, repository } = setup();
    client.getTraining.mockImplementation(async () => {
      context.access.mockRejectedValue(new Error('Revoked'));
      return { body: trainingDetailFixture() };
    });
    await expect(service.refresh(query)).rejects.toThrow('Revoked');
    expect(repository.save).not.toHaveBeenCalled();
    const disconnected = setup();
    disconnected.context.client = null;
    expect((await disconnected.service.refresh(query)).refresh.status).toBe(
      'unavailable',
    );
    expect(disconnected.client.getTrainings).not.toHaveBeenCalled();
    await disconnected.service.list(query);
    expect(disconnected.repository.list).toHaveBeenCalledWith(
      disconnected.context.ownerId,
      'a'.repeat(64),
      expect.anything(),
      new Set(),
    );
  });
  it('rejects a stale binding after detail fetch and before persistence', async () => {
    const { service, client, context, repository } = setup();
    client.getTraining.mockImplementation(async () => {
      context.checkConnection.mockRejectedValueOnce(new Error('Stale binding'));
      return { body: trainingDetailFixture() };
    });
    context.checkConnection.mockImplementation(async () => {
      if (client.getTraining.mock.calls.length > 0)
        throw new Error('Stale binding');
    });
    await expect(service.refresh(query)).rejects.toThrow('Stale binding');
    expect(repository.save).not.toHaveBeenCalled();
  });
  it.each(['disconnect', 'reconnect'] as const)(
    'rejects %s during final authorization before native snapshot SQL',
    async () => {
      const { service, context, repository } = setup();
      let accessCalls = 0;
      let stale = false;
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      context.access.mockImplementation(async () => {
        accessCalls += 1;
        if (accessCalls === 10) {
          entered();
          await gate;
        }
      });
      context.checkBinding.mockImplementation(() => {
        if (stale) throw new Error('TransformMate connection changed');
      });

      const operation = service.refresh(query);
      await ready;
      stale = true;
      release();

      await expect(operation).rejects.toThrow(
        'TransformMate connection changed',
      );
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('rechecks access after the asynchronous connection fence', async () => {
    const { service, context, repository } = setup();
    context.checkConnection.mockImplementationOnce(async () => {
      context.access.mockRejectedValue(new Error('Revoked'));
    });
    await expect(service.list(query)).rejects.toThrow('Revoked');
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('returns an upstream continuation when more than twenty details remain', async () => {
    const { service, client } = setup();
    client.getTrainings.mockResolvedValue({
      body: Array.from({ length: 21 }, (_, index) => ({
        ...trainingSummaryFixture(),
        id: 100 - index,
      })),
    });
    client.getTraining.mockImplementation(async (id: number) => ({
      body: { ...trainingDetailFixture(), id },
    }));
    const result = await service.refresh(query);
    expect(client.getTraining).toHaveBeenCalledTimes(20);
    expect(result.nextCursor).toBe('2026-01-01:81');
  });
});
