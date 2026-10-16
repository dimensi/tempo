import { expect, it, vi } from 'vitest';
import { ReadResourceStore } from '@/lib/read-resource';

it('does not revive a private cached read when its response resolves after logout', async () => {
  const persistence = {
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => {}),
  };
  const store = new ReadResourceStore(persistence);
  const delayed = Promise.withResolvers<{ title: string }>();
  const pending = store.read('private-workout', () => delayed.promise);

  store.clear();
  delayed.resolve({ title: 'private workout' });

  await expect(pending).rejects.toMatchObject({ reason: 'denied' });
  expect(store.snapshot('private-workout').data).toBeUndefined();
  expect(persistence.write).not.toHaveBeenCalled();
});
