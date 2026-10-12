import { z } from 'zod';
import { newPasswordSchema } from './password';
export const inviteInput = z
  .object({
    ownerId: z.string().min(1),
    email: z.email().transform((v) => v.toLowerCase()),
  })
  .strict();
export const acceptInviteInput = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(100),
    password: newPasswordSchema,
  })
  .strict();
export const grantInput = z
  .object({ ownerId: z.string().min(1), trainerId: z.string().min(1) })
  .strict();
export type TrainerDto = {
  id: string;
  name: string;
  email: string;
  granted: boolean;
};

export const acceptInviteErrorSchema = z
  .object({
    error: z.enum([
      'INVITE_INVALID_INPUT',
      'INVITE_UNAVAILABLE',
      'INVITE_ACCOUNT_EXISTS',
    ]),
  })
  .strict();
export const acceptInviteResponseSchema = z
  .object({ accepted: z.literal(true) })
  .strict();
export type AcceptInviteError = z.infer<
  typeof acceptInviteErrorSchema
>['error'];
