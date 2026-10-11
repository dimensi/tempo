import { expect, it } from 'vitest';
import { acceptInviteInput } from '@/contracts/trainers';
import { createCommentInput } from '@/contracts/comments';
it('rejects role escalation and short passwords', () => {
  const input = {
    token: 'a'.repeat(64),
    name: 'Trainer',
    password: 'synthetic-password',
  };
  expect(acceptInviteInput.safeParse({ ...input, role: 'OWNER' }).success).toBe(
    false,
  );
  expect(
    acceptInviteInput.safeParse({ ...input, password: 'short' }).success,
  ).toBe(false);
  expect(acceptInviteInput.safeParse(input).success).toBe(true);
});
it('validates calendar dates and trims bounded comment text', () => {
  const input = {
    ownerId: 'owner',
    target: { type: 'nutrition_day', id: '2026-02-29' },
    body: 'text',
  };
  expect(createCommentInput.safeParse(input).success).toBe(false);
  expect(
    createCommentInput.parse({
      ...input,
      target: { type: 'nutrition_day', id: '2024-02-29' },
      body: '  text  ',
    }).body,
  ).toBe('text');
  expect(
    createCommentInput.safeParse({ ...input, body: ' '.repeat(10) }).success,
  ).toBe(false);
});
