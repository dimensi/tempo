import 'server-only';
import { z } from 'zod';
import type { TransformMateClient } from './client';
const accountResponse = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().max(256).nullable(),
  last_name: z.string().max(256).nullable(),
  email: z.string().max(320).nullable(),
});
export async function readTransformMateAccount(client: TransformMateClient) {
  const response = await client.getMe();
  if (!response.isJson) throw new Error('Invalid TransformMate account');
  const account = accountResponse.safeParse(response.body);
  if (!account.success) throw new Error('Invalid TransformMate account');
  const { id, first_name, last_name, email } = account.data;
  return {
    id,
    name:
      [first_name, last_name].filter(Boolean).join(' ').trim().slice(0, 300) ||
      null,
    email,
  };
}
