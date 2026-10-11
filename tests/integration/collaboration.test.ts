import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import { openDatabase } from '@/server/db/connection';
import { user, account, trainerAccess } from '@/server/db/schema';
import { trainerInvitations } from '@/server/db/schema/trainer-invitations';
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/auth', () => ({
  getAuth: () => ({ api: { getSession: async () => state.session } }),
}));
const database = openDatabase('file::memory:');
vi.mock('@/server/db', () => ({ getDatabase: () => database }));
const { createInvitation, acceptInvitation, setTrainerGrant } =
  await import('@/server/access/trainers');
const { createComment, listComments, changeComment } =
  await import('@/server/comments/service');
const { configureCommentTargets } = await import('@/server/comments/targets');
const headers = new Headers();
const owner = () => {
  state.session = { user: { id: 'owner', role: 'OWNER' } };
};
beforeAll(() => {
  migrate(database.db, { migrationsFolder: './drizzle' });
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['trainer', 'TRAINER'],
    ['other', 'TRAINER'],
  ] as const)
    database.db
      .insert(user)
      .values({
        id,
        role,
        name: id,
        email: `${id}@example.test`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  configureCommentTargets(
    (ownerId, target) => ownerId === 'owner' && target.id === '2026-10-11',
  );
});
afterAll(() => database.sqlite.close());
it('rechecks grants after an asynchronous target lookup for reads and mutations', async () => {
  const scope = {
    ownerId: 'owner',
    target: { type: 'measurement', id: 'race-target' },
  };
  owner();
  configureCommentTargets(() => true);
  await setTrainerGrant(
    headers,
    { ownerId: 'owner', trainerId: 'trainer' },
    true,
  );
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  const root = await createComment(headers, {
    ...scope,
    body: 'Before revocation',
  });
  for (const operation of [
    () => listComments(headers, scope),
    () => createComment(headers, { ...scope, body: 'After revocation' }),
    () =>
      changeComment(
        headers,
        root.id,
        { ownerId: 'owner', body: 'Changed' },
        false,
      ),
    () => changeComment(headers, root.id, { ownerId: 'owner' }, true),
  ]) {
    owner();
    await setTrainerGrant(
      headers,
      { ownerId: 'owner', trainerId: 'trainer' },
      true,
    );
    state.session = { user: { id: 'trainer', role: 'TRAINER' } };
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    configureCommentTargets(async () => {
      entered();
      await pending;
      return true;
    });
    const result = operation();
    const rejected = expect(result).rejects.toMatchObject({ status: 403 });
    await started;
    database.db
      .delete(trainerAccess)
      .where(eq(trainerAccess.trainerId, 'trainer'))
      .run();
    release();
    await rejected;
  }
  configureCommentTargets(
    (ownerId, target) => ownerId === 'owner' && target.id === '2026-10-11',
  );
});
it('checks session, owner scope and trainer management role', async () => {
  state.session = null;
  await expect(
    createInvitation(headers, { ownerId: 'owner', email: 'new@example.test' }),
  ).rejects.toMatchObject({ status: 401 });
  owner();
  await expect(
    createInvitation(headers, {
      ownerId: 'another',
      email: 'new@example.test',
    }),
  ).rejects.toMatchObject({ status: 403 });
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(
    setTrainerGrant(headers, { ownerId: 'owner', trainerId: 'trainer' }, true),
  ).rejects.toMatchObject({ status: 403 });
});
it('stores only hash, accepts once, forces trainer role and writes a compatible credential atomically', async () => {
  owner();
  const result = await createInvitation(headers, {
    ownerId: 'owner',
    email: 'new@example.test',
  });
  const row = database.db.select().from(trainerInvitations).get()!;
  expect(row.tokenHash).not.toBe(result.token);
  expect(row.tokenHash).toHaveLength(64);
  const input = {
    token: result.token,
    name: 'New trainer',
    password: 'Synthetic-password-123',
  };
  await expect(
    acceptInvitation({ ...input, role: 'OWNER' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await acceptInvitation(input)).toEqual({ accepted: true });
  const created = database.db
    .select()
    .from(user)
    .where(eq(user.email, 'new@example.test'))
    .get()!;
  expect(created.role).toBe('TRAINER');
  const credential = database.db
    .select()
    .from(account)
    .where(eq(account.userId, created.id))
    .get()!;
  expect(credential.providerId).toBe('credential');
  expect(
    await verifyPassword({
      hash: credential.password!,
      password: input.password,
    }),
  ).toBe(true);
  expect(
    database.db
      .select()
      .from(trainerAccess)
      .where(eq(trainerAccess.trainerId, created.id))
      .get()?.ownerId,
  ).toBe('owner');
  await expect(acceptInvitation(input)).rejects.toMatchObject({ status: 400 });
});
it('expired invitations fail and duplicate-account failure rolls consumption back', async () => {
  owner();
  const result = await createInvitation(headers, {
    ownerId: 'owner',
    email: 'trainer@example.test',
  });
  const input = {
    token: result.token,
    name: 'Duplicate',
    password: 'Synthetic-password-123',
  };
  await expect(acceptInvitation(input)).rejects.toMatchObject({ status: 409 });
  const row = database.db
    .select()
    .from(trainerInvitations)
    .where(eq(trainerInvitations.email, 'trainer@example.test'))
    .get()!;
  expect(row.consumedAt).toBeNull();
  database.db
    .update(trainerInvitations)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(trainerInvitations.id, row.id))
    .run();
  await expect(acceptInvitation(input)).rejects.toMatchObject({ status: 400 });
});
it('rejects nonexistent or foreign targets, nonauthors and revoked trainers with retained sessions', async () => {
  owner();
  const scope = {
    ownerId: 'owner',
    target: { type: 'nutrition_day', id: '2026-10-11' },
  };
  await expect(
    createComment(headers, {
      ...scope,
      target: { type: 'measurement', id: 'missing' },
      body: 'test',
    }),
  ).rejects.toMatchObject({ status: 404 });
  const root = await createComment(headers, {
    ...scope,
    body: 'Owner comment',
  });
  await setTrainerGrant(
    headers,
    { ownerId: 'owner', trainerId: 'trainer' },
    true,
  );
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(
    changeComment(
      headers,
      root.id,
      { ownerId: 'owner', body: 'Hijack' },
      false,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const reply = await createComment(headers, {
    ...scope,
    body: 'Trainer reply',
    parentId: root.id,
  });
  await expect(
    createComment(headers, {
      ...scope,
      body: 'Wrong parent',
      target: { type: 'workout', id: '2026-10-11' },
      parentId: root.id,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (await listComments(headers, scope)).find((row) => row.id === reply.id)
      ?.canEdit,
  ).toBe(true);
  await changeComment(
    headers,
    reply.id,
    { ownerId: 'owner', body: 'Edited' },
    false,
  );
  owner();
  await setTrainerGrant(
    headers,
    { ownerId: 'owner', trainerId: 'trainer' },
    false,
  );
  state.session = { user: { id: 'trainer', role: 'TRAINER' } };
  await expect(listComments(headers, scope)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    changeComment(headers, reply.id, { ownerId: 'owner' }, true),
  ).rejects.toMatchObject({ status: 403 });
  owner();
  await expect(
    listComments(headers, { ...scope, ownerId: 'foreign' }),
  ).rejects.toMatchObject({ status: 403 });
  await changeComment(headers, root.id, { ownerId: 'owner' }, true);
  expect(
    (await listComments(headers, scope)).find((row) => row.id === reply.id)
      ?.parentId,
  ).toBeNull();
  state.session = null;
  await expect(listComments(headers, scope)).rejects.toMatchObject({
    status: 401,
  });
});
