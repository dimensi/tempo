import { withApiErrors } from '@/server/auth/api-response';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ session: vi.fn(), owner: vi.fn() }));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: state.session } }),
}));
vi.mock('@/server/access/owner', () => ({ getAccessibleOwnerId: state.owner }));
beforeEach(() => {
  vi.clearAllMocks();
  state.session.mockResolvedValue({ user: { id: 'trainer', role: 'TRAINER' } });
  state.owner.mockResolvedValue('owner');
});
const request = new Request('https://app.test/api/resource');
it('distinguishes expired authentication, revoked global grant and action-level denial', async () => {
  const handler = withApiErrors(async () =>
    Response.json({ error: 'Denied' }, { status: 403 }),
  );
  expect(await (await handler(request)).json()).toEqual({ error: 'FORBIDDEN' });
  state.owner.mockResolvedValue(null);
  expect(await (await handler(request)).json()).toEqual({
    error: 'ACCESS_REVOKED',
  });
  state.session.mockResolvedValue(null);
  const response = await withApiErrors(
    async () => new Response('', { status: 401 }),
  )(request);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' });
});
it('does not turn ordinary resource/server failures into logout', async () => {
  for (const status of [404, 409, 429, 503])
    expect(
      (await withApiErrors(async () => new Response('', { status }))(request))
        .status,
    ).toBe(status);
  expect(state.session).not.toHaveBeenCalled();
});
