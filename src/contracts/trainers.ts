import { z } from 'zod';
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
    password: z.string().min(12).max(128),
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
