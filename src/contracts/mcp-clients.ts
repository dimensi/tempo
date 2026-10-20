import { z } from 'zod';

export const mcpClientInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  callback: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.hash
      );
    }),
});
export const mcpClientRow = z.object({
  clientId: z.string(),
  name: z.string(),
  callback: z.string(),
  disabled: z.boolean(),
  createdAt: z.string().nullable(),
});
export const mcpClientList = z.object({
  endpoint: z.url(),
  clients: z.array(mcpClientRow),
});
export const mcpClientCredentials = z.object({
  client_id: z.string(),
  client_secret: z.string().min(1),
});
export const mcpClientRevoke = z.strictObject({
  clientId: z.string().min(1).max(256),
});
