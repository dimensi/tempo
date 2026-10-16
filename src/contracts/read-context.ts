import { z } from 'zod';
export const readContextSchema = z.strictObject({
  readerId: z.string().min(1).max(200),
  ownerId: z.string().max(200),
  role: z.enum(['OWNER', 'TRAINER']),
  partition: z.string().min(1),
});
export type ReadContext = z.infer<typeof readContextSchema>;
