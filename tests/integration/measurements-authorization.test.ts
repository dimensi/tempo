import { vi, it, expect, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
const { authorize, list, create, find } = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(() => []),
  create: vi.fn(),
  find: vi.fn(),
}));
vi.mock('@/server/auth/guards', () => ({ authorize }));
vi.mock('@/server/measurements/repository', () => ({
  measurementRepository: () => ({ list, create, find }),
}));
import {
  listMeasurements,
  saveMeasurement,
  measurementExists,
} from '@/server/measurements';
beforeEach(() => vi.clearAllMocks());
it('propagates read denials without accessing persistence', async () => {
  authorize.mockResolvedValue({ ok: false, status: 403 });
  await expect(listMeasurements(new Headers(), 'other')).rejects.toMatchObject({
    status: 403,
  });
  expect(authorize).toHaveBeenCalledWith(
    expect.any(Headers),
    'measurements:read',
    'other',
  );
  expect(list).not.toHaveBeenCalled();
});
it('rejects trainer writes before validating or writing', async () => {
  authorize.mockResolvedValue({ ok: false, status: 403 });
  await expect(
    saveMeasurement(new Headers(), 'owner', {}),
  ).rejects.toMatchObject({ status: 403 });
  expect(authorize).toHaveBeenCalledWith(
    expect.any(Headers),
    'measurements:write',
    'owner',
  );
  expect(create).not.toHaveBeenCalled();
});
it('validates input after authorization', async () => {
  authorize.mockResolvedValue({ ok: true });
  await expect(
    saveMeasurement(new Headers(), 'owner', {}),
  ).rejects.toMatchObject({ status: 400 });
  expect(create).not.toHaveBeenCalled();
});
it('target existence is authorized and owner scoped', async () => {
  authorize.mockResolvedValue({ ok: true });
  find.mockReturnValue(undefined);
  expect(await measurementExists(new Headers(), 'owner', 'id')).toBe(false);
  expect(find).toHaveBeenCalledWith('owner', 'id');
});
