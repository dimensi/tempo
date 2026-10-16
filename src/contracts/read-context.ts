import { z } from 'zod';
export const readContextSchema = z.strictObject({
  readerId: z.string().min(1).max(200),
  ownerId: z.string().min(1).max(200),
  role: z.enum(['OWNER', 'TRAINER']),
  partition: z.string(),
  connectionGeneration: z.string(),
});
export type ReadContext = z.infer<typeof readContextSchema>;
